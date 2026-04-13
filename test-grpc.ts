import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';

// --- Types integration ---
import type { ProtoGrpcType } from './lib/grpc/types/tdd_openmaic';
import type { TddOpenmaicServiceHandlers } from './lib/grpc/types/tdd/v1/TddOpenmaicService';

// 1. Initializing Server configurations
const PROTO_PATH = path.join(process.cwd(), 'lib/grpc/proto/tdd_openmaic.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as unknown as ProtoGrpcType;
const serviceDef = protoDescriptor.tdd.v1.TddOpenmaicService.service;

async function runMockServer() {
  const server = new grpc.Server();

  // 2. Add Handlers (mocking the upstream backend)
  const handlers: TddOpenmaicServiceHandlers = {
    GetAssembledPrompt(call, callback) {
      console.log('✅ [Server] Received request for prompt_id:', call.request.prompt_id);
      
      if (!call.request.prompt_id) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'prompt_id is missing',
        }, null);
      }

      // Mock response
      callback(null, {
        prompt: `This is a mock, completely assembled AI prompt triggered by ID: ${call.request.prompt_id}`,
      });
    },

    ReportUserQuestionPrompt(call, callback) {
      console.log('✅ [Server] Received report for user question:', call.request);
      callback(null, {
        prompt_id: `mock-prompt-id-${Date.now()}`
      });
    }
  };

  server.addService(serviceDef, handlers);

  // 3. Start Server
  const port = '0.0.0.0:50051';
  return new Promise((resolve, reject) => {
    server.bindAsync(port, grpc.ServerCredentials.createInsecure(), (err, boundPort) => {
      if (err) {
        console.error('❌ [Server] Failed to bind:', err);
        reject(err);
      } else {
        console.log(`🚀 [Server] Mock gRPC server running at ${port}`);
        server.start();
        resolve(server);
      }
    });
  });
}

// --- Execute ---
async function main() {
  try {
    const serverInstance = await runMockServer();
    console.log('💡 [Tip] You can now access /soo?tempId=123 in your browser to hit this mock server.');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
