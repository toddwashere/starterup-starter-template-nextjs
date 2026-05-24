import {
  askAssistantChat,
  call as assistantChatCall,
  variables as assistantChatVariables,
} from "./assistant-chat/assistant-chat";
import {
  call as workerExampleCall,
  runWorkerExample,
} from "./worker-example/worker-example";

export {
  askAssistantChat,
  assistantChatCall,
  assistantChatVariables,
  runWorkerExample,
  workerExampleCall,
};

/** Registry of all named AI calls — for introspection and evals (not app dispatch). */
export const AI_CALLS = {
  "assistant-chat": assistantChatCall,
  "worker-example": workerExampleCall,
} as const;

export type AiCallId = keyof typeof AI_CALLS;
