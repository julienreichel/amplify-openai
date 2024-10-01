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

