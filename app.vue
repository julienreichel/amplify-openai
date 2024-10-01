<template>
  <div class="container">
    <h1>ChatGPT Interface</h1>

    <!-- Prompt Input -->
    <label for="prompt">Prompt</label>
    <textarea v-model="prompt" id="prompt" rows="6" class="input"></textarea>

    <!-- Submit Button and Progress Icon -->
    <div class="controls">
      <button @click="sendRequest" :disabled="loading">Send Request</button>
      <div v-if="loading" class="spinner"></div>
    </div>

    <!-- Response Output -->
    <label for="response">Response</label>
    <textarea
      id="response"
      rows="8"
      class="output"
      v-model="response"
      readonly
    ></textarea>
  </div>
</template>

<script setup lang="ts">
import { Amplify } from 'aws-amplify';
import outputs from './amplify_outputs.json';
Amplify.configure(outputs);

import { generateClient } from 'aws-amplify/data';
const client = generateClient();

// Define reactive state
const systemQuery = ref('');
const prompt = ref('');
const response = ref('');
const loading = ref(false);

const sendRequest = async () => {
  loading.value = true;
  response.value = ''; // Clear previous response

  // Prepare the request payload
  const input = {
    prompt: prompt.value,
    token: 1000
  };
  const options = {};

  try {
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
  } catch (e) {
    response.value =
      'Error: Unable to fetch the response. Please check the API settings or your query.';
    console.error(e);
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped>
.container {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

label {
  font-weight: bold;
  margin-top: 10px;
  display: block;
}

.input {
  width: 100%;
  padding: 10px;
  margin-bottom: 15px;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.output {
  width: 100%;
  padding: 10px;
  margin-top: 15px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background-color: #f7f7f7;
}

.controls {
  display: flex;
  align-items: center;
}

button {
  padding: 10px 20px;
  width: 100%;
  background-color: #42b983;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

button:disabled {
  background-color: #aaa;
  cursor: not-allowed;
}

.spinner {
  margin-left: 10px;
  width: 24px;
  height: 24px;
  border: 3px solid rgba(0, 0, 0, 0.1);
  border-top: 3px solid #42b983;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
</style>
