import { startHealthServer } from "./health";

const port = Number(process.env.WORKER_HEALTH_PORT ?? 4300);

startHealthServer(port);

console.log(`[workers] started`);

// TODO(Task 9): construct the registry + pgmq adapter and start the consumer
