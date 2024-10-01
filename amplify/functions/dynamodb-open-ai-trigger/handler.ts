import type { DynamoDBStreamHandler } from "aws-lambda";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(client);

import { env } from "$amplify/env/dynamodb-open-ai-trigger";

export const handler: DynamoDBStreamHandler = async (event) => {
  const apiKey = env.OPENAI_API_KEY;

  /**
   * @param {object} body
   * @returns {Promise<any>}
   */
  const request = async (body: object): Promise<any> => {
    const END_POINT = "https://api.openai.com/v1/chat/completions";

    const response = await fetch(END_POINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    return await response.json();
  };

  await Promise.all(
    event.Records.map(async (record) => {

      if (record.eventName === "INSERT") {
        const tableName = record.eventSourceARN?.split("/")[1];
        const key = record.dynamodb?.Keys?.id?.S;
        const row = record.dynamodb?.NewImage;

        if (!tableName || !row || !key) return;

        const temperature = Number(env.OPENAI_TEMPERATURE) || 0.7;

        const max_tokens =
          Number(row.token?.N) || Number(env.OPENAI_MAX_TOKEN) || 50;

        const format = row.format?.S || "text";
        const model = row.model?.S || env.OPENAI_MODEL || "gpt-4o-mini";
        let messages = [];
        if (row.system?.S) {
          messages.push({ role: "system", content: row.system?.S });
        }
        if (row.prompt?.S) {
          messages.push({ role: "user", content: row.prompt?.S });
        }

        let response_format;
        if (format === "json") {
          response_format = { type: "json_object" };
        }
        const body = {
          messages,
          model,
          max_tokens,
          temperature,
          response_format,
        };

        let data = await request(body);

        // write the result into the table
        if (data.error) {
          data.choices = [
            {
              message: { content: data.error.message },
              finish_reason: data.error.code,
            },
          ];
          data.usage = {};
        }
        const updateParams = {
          TableName: tableName,
          Key: { id: key },
          UpdateExpression:
            "set content = :content, finish_reason = :finish_reason, token_usage = :token_usage, updatedAt = :updatedAt",
          ExpressionAttributeValues: {
            ":content": data.choices[0].message.content.trim(),
            ":finish_reason": data.choices[0].finish_reason,
            ":token_usage": data.usage,
            ":updatedAt": new Date().toISOString(),
          },
        };
        const command = new UpdateCommand(updateParams);
        await ddbDocClient.send(command);
      }
    }),
  );

  return {
    batchItemFailures: [],
  };
};
