import { defineFunction, secret } from "@aws-amplify/backend";

export const dynamoDBOpenAITrigger = defineFunction({
  name: "dynamodb-open-ai-trigger",
  timeoutSeconds: 300,
  environment: {
    OPENAI_API_KEY: secret("OPENAI_API_KEY"),
    OPENAI_MODEL: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    OPENAI_MAX_TOKEN: process.env.OPENAI_MAX_TOKEN ?? "500",
    OPENAI_TEMPERATURE: process.env.OPENAI_TEMPERATURE ?? "0.7",
  },
});
