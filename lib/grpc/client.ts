/* eslint-disable @typescript-eslint/no-explicit-any */
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';

const PROTO_PATH = path.join(process.cwd(), 'lib/grpc/proto/task.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
// @ts-expect-error Any type placeholder
const taskPackage = protoDescriptor.task;

let client: any = null;

export function getTaskGrpcClient() {
  if (!client) {
    const address = process.env.GRPC_SERVER_ADDRESS || 'localhost:50051';
    // Using insecure credentials for default configuration
    // @ts-expect-error Any type placeholder
    client = new taskPackage.TaskOrchestrationService(address, grpc.credentials.createInsecure());
  }
  return client;
}

export async function fetchTaskContent(tempId: string): Promise<string> {
  const gRpcClient = getTaskGrpcClient();

  return new Promise((resolve, reject) => {
    gRpcClient.GetTaskContent({ temp_id: tempId }, (err: any, response: any) => {
      if (err) {
        return reject(err);
      }
      if (!response.success) {
        return reject(new Error('Failed to fetch task content from gRPC'));
      }
      resolve(response.content || '');
    });
  });
}
