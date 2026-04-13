// Original file: lib/grpc/proto/tdd_openmaic.proto

import type * as grpc from '@grpc/grpc-js'
import type { MethodDefinition } from '@grpc/proto-loader'
import type { GetAssembledPromptRequest as _tdd_v1_GetAssembledPromptRequest, GetAssembledPromptRequest__Output as _tdd_v1_GetAssembledPromptRequest__Output } from '../../tdd/v1/GetAssembledPromptRequest';
import type { GetAssembledPromptResponse as _tdd_v1_GetAssembledPromptResponse, GetAssembledPromptResponse__Output as _tdd_v1_GetAssembledPromptResponse__Output } from '../../tdd/v1/GetAssembledPromptResponse';
import type { ReportUserQuestionPromptRequest as _tdd_v1_ReportUserQuestionPromptRequest, ReportUserQuestionPromptRequest__Output as _tdd_v1_ReportUserQuestionPromptRequest__Output } from '../../tdd/v1/ReportUserQuestionPromptRequest';
import type { ReportUserQuestionPromptResponse as _tdd_v1_ReportUserQuestionPromptResponse, ReportUserQuestionPromptResponse__Output as _tdd_v1_ReportUserQuestionPromptResponse__Output } from '../../tdd/v1/ReportUserQuestionPromptResponse';

export interface TddOpenmaicServiceClient extends grpc.Client {
  GetAssembledPrompt(argument: _tdd_v1_GetAssembledPromptRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_tdd_v1_GetAssembledPromptResponse__Output>): grpc.ClientUnaryCall;
  GetAssembledPrompt(argument: _tdd_v1_GetAssembledPromptRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_tdd_v1_GetAssembledPromptResponse__Output>): grpc.ClientUnaryCall;
  GetAssembledPrompt(argument: _tdd_v1_GetAssembledPromptRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_tdd_v1_GetAssembledPromptResponse__Output>): grpc.ClientUnaryCall;
  GetAssembledPrompt(argument: _tdd_v1_GetAssembledPromptRequest, callback: grpc.requestCallback<_tdd_v1_GetAssembledPromptResponse__Output>): grpc.ClientUnaryCall;
  getAssembledPrompt(argument: _tdd_v1_GetAssembledPromptRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_tdd_v1_GetAssembledPromptResponse__Output>): grpc.ClientUnaryCall;
  getAssembledPrompt(argument: _tdd_v1_GetAssembledPromptRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_tdd_v1_GetAssembledPromptResponse__Output>): grpc.ClientUnaryCall;
  getAssembledPrompt(argument: _tdd_v1_GetAssembledPromptRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_tdd_v1_GetAssembledPromptResponse__Output>): grpc.ClientUnaryCall;
  getAssembledPrompt(argument: _tdd_v1_GetAssembledPromptRequest, callback: grpc.requestCallback<_tdd_v1_GetAssembledPromptResponse__Output>): grpc.ClientUnaryCall;
  
  ReportUserQuestionPrompt(argument: _tdd_v1_ReportUserQuestionPromptRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_tdd_v1_ReportUserQuestionPromptResponse__Output>): grpc.ClientUnaryCall;
  ReportUserQuestionPrompt(argument: _tdd_v1_ReportUserQuestionPromptRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_tdd_v1_ReportUserQuestionPromptResponse__Output>): grpc.ClientUnaryCall;
  ReportUserQuestionPrompt(argument: _tdd_v1_ReportUserQuestionPromptRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_tdd_v1_ReportUserQuestionPromptResponse__Output>): grpc.ClientUnaryCall;
  ReportUserQuestionPrompt(argument: _tdd_v1_ReportUserQuestionPromptRequest, callback: grpc.requestCallback<_tdd_v1_ReportUserQuestionPromptResponse__Output>): grpc.ClientUnaryCall;
  reportUserQuestionPrompt(argument: _tdd_v1_ReportUserQuestionPromptRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_tdd_v1_ReportUserQuestionPromptResponse__Output>): grpc.ClientUnaryCall;
  reportUserQuestionPrompt(argument: _tdd_v1_ReportUserQuestionPromptRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_tdd_v1_ReportUserQuestionPromptResponse__Output>): grpc.ClientUnaryCall;
  reportUserQuestionPrompt(argument: _tdd_v1_ReportUserQuestionPromptRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_tdd_v1_ReportUserQuestionPromptResponse__Output>): grpc.ClientUnaryCall;
  reportUserQuestionPrompt(argument: _tdd_v1_ReportUserQuestionPromptRequest, callback: grpc.requestCallback<_tdd_v1_ReportUserQuestionPromptResponse__Output>): grpc.ClientUnaryCall;
  
}

export interface TddOpenmaicServiceHandlers extends grpc.UntypedServiceImplementation {
  GetAssembledPrompt: grpc.handleUnaryCall<_tdd_v1_GetAssembledPromptRequest__Output, _tdd_v1_GetAssembledPromptResponse>;
  
  ReportUserQuestionPrompt: grpc.handleUnaryCall<_tdd_v1_ReportUserQuestionPromptRequest__Output, _tdd_v1_ReportUserQuestionPromptResponse>;
  
}

export interface TddOpenmaicServiceDefinition extends grpc.ServiceDefinition {
  GetAssembledPrompt: MethodDefinition<_tdd_v1_GetAssembledPromptRequest, _tdd_v1_GetAssembledPromptResponse, _tdd_v1_GetAssembledPromptRequest__Output, _tdd_v1_GetAssembledPromptResponse__Output>
  ReportUserQuestionPrompt: MethodDefinition<_tdd_v1_ReportUserQuestionPromptRequest, _tdd_v1_ReportUserQuestionPromptResponse, _tdd_v1_ReportUserQuestionPromptRequest__Output, _tdd_v1_ReportUserQuestionPromptResponse__Output>
}
