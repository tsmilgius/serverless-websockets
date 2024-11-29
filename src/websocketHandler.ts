import {
  APIGatewayProxyEvent,
  APIGatewayProxyEventQueryStringParameters,
  APIGatewayProxyResult,
} from "aws-lambda";
import {
  DynamoDBClient,
  PutItemCommand,
  DeleteItemCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import {
  ApiGatewayManagementApi,
  GoneException,
} from "@aws-sdk/client-apigatewaymanagementapi";

const responseOK = {
  statusCode: 200,
  body: "OK",
};
const responseDisconnected = {
  statusCode: 203,
  body: "disconnected",
};

const responseForbidden = {
  statusCode: 403,
  body: "",
};

const endpoint = process.env["GW_URL"] || "";
const apiGatewayManagementApi = new ApiGatewayManagementApi({
  endpoint: endpoint,
});

const dynamoDBClient = new DynamoDBClient({});
const clientsTable = process.env["CLIENTS_TABLE"] || "";

const textEncoder = new TextEncoder();

const handleConnect = async (
  connectionId: string,
  queryParameters: APIGatewayProxyEventQueryStringParameters | null
): Promise<APIGatewayProxyResult> => {
  await dynamoDBClient.send(
    new PutItemCommand({
      TableName: clientsTable,
      Item: {
        connectionId: { S: connectionId },
      },
    })
  );

  return responseOK;
};

const handleDisconnect = async (
  connectionId: string
): Promise<APIGatewayProxyResult> => {
  await dynamoDBClient.send(
    new DeleteItemCommand({
      TableName: clientsTable,
      Key: {
        connectionId: { S: connectionId },
      },
    })
  );
  return responseOK;
};

const handleMsg = async (
  connectionId: string,
  body: string
): Promise<APIGatewayProxyResult> => {
  const output = await dynamoDBClient.send(
    new ScanCommand({
      TableName: clientsTable,
    })
  );

  if (output.Count && output.Count > 0) {
    for (const item of output.Items || []) {
      const connectionIdInTheTable = item.connectionId.S as string;
      await sendMessage(connectionIdInTheTable, body);
    }
  }
  return responseOK;
};

const sendMessage = async (connectionId: string, messageBody: string) => {
  try {
    await apiGatewayManagementApi.postToConnection({
      ConnectionId: connectionId,
      Data: textEncoder.encode(messageBody),
    });
  } catch (error) {
    if (error instanceof GoneException) {
      await handleDisconnect(connectionId);
    }
    throw error;
  }
};

export const handle = async (event: APIGatewayProxyEvent) => {
  const connectionId = event.requestContext.connectionId as string;
  const routeKey = event.requestContext.routeKey as string;
  const body = event.body || "";

  try {
    switch (routeKey) {
      case "$connect":
        return handleConnect(connectionId, event.queryStringParameters);
      case "$disconnect":
        return handleDisconnect(connectionId);
      case "message":
        return handleMsg(connectionId, body);
      case "$default":
        return responseForbidden;
      default:
        return responseForbidden;
    }
  } catch (e) {
    return responseForbidden;
  }
};
