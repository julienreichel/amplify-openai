# Creating a Nuxt project in AWS Amplify to send request to Open AI

### Creating the Nuxt project
To create the project

```bash
npx nuxi@latest init <project-name>
```

To push to github

```bash
cd /path/to/<project-name>
git init
git remote add origin <repo-url>
git add .
git commit -m "Adding Nuxt"
git push -u origin main
```

### Deploying the site using Amplify
Nothing special to do, just follow the steps explained in https://nuxt.com/deploy/aws-amplify

### Adding Amplify for the backend
Assuming Amplify is already installed and setup done.

Initialise Amplify for the project

```bash
npm create amplify@latest.
```

### Creating a shcema for OpenAI request
Next step is to create a new GraphQL schema for Open AI request.
Instead of using a resolver (i.e. a function that will be called when the GraphQL end-point is called to return the data),
we will do something smarther that do not suffer from the 30s GraphQL limits.

The call to the API, will post the data for the Open AI query, and return with an ID.
The request data is stored in the DynamoDb table.
Then a trigger will be called in the backend to process the query with Open AI, this lambda function can have
a long timeout, as it is not bounded by the limit of the GraphQL request time.
Once the lambda receives the response it updates the DynamoDB table.
Then the front-end can be notified that the data was updated, and fetch the result returned by OpenAI

This is inspired from [dynamo-db-stream](https://docs.amplify.aws/vue/build-a-backend/functions/examples/dynamo-db-stream/)


First step install a few needed depdencies
```bash
npm add --save-dev @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @types/aws-lambda aws-cdk-lib
```

The update the shema for the GraphQL Query (`amplify/data/resource.ts`)

```javascript
import type { ClientSchema } from "@aws-amplify/backend";
import { a, defineData } from "@aws-amplify/backend";

const schema = a.schema({

  OpenAIUsage: a.customType({
    prompt_tokens: a.integer(),
    completion_tokens: a.integer(),
    total_tokens: a.integer(),
  }),

  OpenAIRequest: a
    .model({
      id: a.id().required(),
      system: a.string(),
      prompt: a.string(),
      token: a.integer(),
      format: a.string(),
      model: a.string(),
      content: a.string(),
      token_usage: a.ref("OpenAIUsage"),
      finish_reason: a.string(),
      ttl: a.integer(),
    })
    .authorization((allow) => [allow.guest()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "iam",
  },
});
```

Then add the lambda codes (`amplify/functions/dynamodb-open-ai-trigger/handler.ts`)

```javascript
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

        const format = row.format?.S || "json";
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
```

Create the resource info (`amplify/functions/dynamodb-open-ai-trigger/resource.ts`).
This provide default value and, the API key stored as a secret in amplify

```javascript
import { defineFunction, secret } from "@aws-amplify/backend";

export const dynamoDBAITrigger = defineFunction({
  name: "dynamodb-open-ai-trigger",
  timeoutSeconds: 300,
  environment: {
    OPENAI_API_KEY: secret("OPENAI_API_KEY"),
    OPENAI_MODEL: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    OPENAI_MAX_TOKEN: process.env.OPENAI_MAX_TOKEN ?? "500",
    OPENAI_TEMPERATURE: process.env.OPENAI_TEMPERATURE ?? "0.7",
  },
});
```

Finally, updade the backend definition file, to enable the trigger

```javascript
import { defineBackend } from "@aws-amplify/backend";
import { auth } from './auth/resource';
import { data } from './data/resource';

import { Stack } from "aws-cdk-lib";
import { Effect, Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { EventSourceMapping, StartingPosition } from "aws-cdk-lib/aws-lambda";

import { dynamoDBOpenAITrigger } from "./functions/dynamodb-open-ai-trigger/resource";

const backend = defineBackend({
  auth,
  data,
  dynamoDBOpenAITrigger
});

const OpenAIRequestTable = backend.data.resources.tables["OpenAIRequest"];
const policy = new Policy(
  Stack.of(OpenAIRequestTable),
  "DynamoDBTriggerPolicyForLambda",
  {
    statements: [
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "dynamodb:DescribeStream",
          "dynamodb:GetRecords",
          "dynamodb:GetShardIterator",
          "dynamodb:ListStreams",
          "dynamodb:UpdateItem",
        ],
        resources: ["*"],
      }),
    ],
  },
);
backend.dynamoDBOpenAITrigger.resources.lambda.role?.attachInlinePolicy(policy);

const mapping = new EventSourceMapping(
  Stack.of(OpenAIRequestTable),
  "DynamoDBTriggerEvent",
  {
    target: backend.dynamoDBOpenAITrigger.resources.lambda,
    eventSourceArn: OpenAIRequestTable.tableStreamArn,
    startingPosition: StartingPosition.LATEST,
  },
);
mapping.node.addDependency(policy);

backend.data.resources.cfnResources.amplifyDynamoDbTables[
  "OpenAIRequest"
].timeToLiveAttribute = {
  attributeName: "ttl",
  enabled: true,
};
```

### Making the call from the front-end
The last part is to use the GraphGL query to trigger and get the response.
The code bellow uses active check to see if there is an answer, with a maximum
waiting time of 5min

```javascript
import { Amplify } from 'aws-amplify';
import outputs from './amplify_outputs.json';
Amplify.configure(outputs);

import { generateClient } from 'aws-amplify/data';
const client = generateClient();

// Prepare the request payload
const input = {
    system: systemQuery.value,
    prompt: prompt.value,
    token: 1000
};
const { data, error } = await client.models.OpenAIRequest.create(input);
if (error) {
    throw new Error('Error fetching response from ChatGPT API');
}
const requestId = data.id;
// now we wait, at most 300s, with backoff retry
let totalWaitTime = 0;
let waitTime = 2000;
while (totalWaitTime < 300 * 1000) {
    await new Promise((resolve) => setTimeout(resolve, waitTime));
    totalWaitTime += waitTime;
    waitTime = Math.min(waitTime + 1000, 10000);

    const { data } = await client.models.OpenAIRequest.get({ id: requestId });
    if (data.finish_reason) {
    response.value = data.content;
    break;
    }
}
```