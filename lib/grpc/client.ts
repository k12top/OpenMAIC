import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import type { ProtoGrpcType } from './types/tdd_openmaic';
import type { TddOpenmaicServiceClient } from './types/tdd/v1/TddOpenmaicService';

const PROTO_PATH = path.join(process.cwd(), 'lib/grpc/proto/tdd_openmaic.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as unknown as ProtoGrpcType;

const tddPackage = protoDescriptor.tdd;
const v1Package = tddPackage.v1;

let client: TddOpenmaicServiceClient | null = null;

export function getTaskGrpcClient(): TddOpenmaicServiceClient {
  if (!client) {
    const address = process.env.GRPC_SERVER_ADDRESS || 'localhost:50051';
    // Using insecure credentials for default configuration
    // @ts-expect-error Any type placeholder
    client = new v1Package.TddOpenmaicService(address, grpc.credentials.createInsecure());
  }
  return client;
}

export async function fetchTaskContent(tempId: string): Promise<string> {
  const gRpcClient = getTaskGrpcClient();

  return new Promise((resolve, reject) => {
    gRpcClient.GetAssembledPrompt({ prompt_id: tempId }, (err: grpc.ServiceError | null, response: any) => {
      if (err) {
        return reject(err);
      }
      if (!response || !response.prompt) {
        return reject(new Error('Failed to fetch assembled prompt from gRPC or prompt is empty'));
      }
      resolve(response.prompt);
    });
  });
}
