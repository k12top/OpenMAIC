import type * as grpc from '@grpc/grpc-js';
import type { MessageTypeDefinition } from '@grpc/proto-loader';

import type { GetAssembledPromptRequest as _tdd_v1_GetAssembledPromptRequest, GetAssembledPromptRequest__Output as _tdd_v1_GetAssembledPromptRequest__Output } from './tdd/v1/GetAssembledPromptRequest';
import type { GetAssembledPromptResponse as _tdd_v1_GetAssembledPromptResponse, GetAssembledPromptResponse__Output as _tdd_v1_GetAssembledPromptResponse__Output } from './tdd/v1/GetAssembledPromptResponse';
import type { ReportUserQuestionPromptRequest as _tdd_v1_ReportUserQuestionPromptRequest, ReportUserQuestionPromptRequest__Output as _tdd_v1_ReportUserQuestionPromptRequest__Output } from './tdd/v1/ReportUserQuestionPromptRequest';
import type { ReportUserQuestionPromptResponse as _tdd_v1_ReportUserQuestionPromptResponse, ReportUserQuestionPromptResponse__Output as _tdd_v1_ReportUserQuestionPromptResponse__Output } from './tdd/v1/ReportUserQuestionPromptResponse';
import type { TddOpenmaicServiceClient as _tdd_v1_TddOpenmaicServiceClient, TddOpenmaicServiceDefinition as _tdd_v1_TddOpenmaicServiceDefinition } from './tdd/v1/TddOpenmaicService';

type SubtypeConstructor<Constructor extends new (...args: any) => any, Subtype> = {
  new(...args: ConstructorParameters<Constructor>): Subtype;
};

export interface ProtoGrpcType {
  tdd: {
    v1: {
      GetAssembledPromptRequest: MessageTypeDefinition<_tdd_v1_GetAssembledPromptRequest, _tdd_v1_GetAssembledPromptRequest__Output>
      GetAssembledPromptResponse: MessageTypeDefinition<_tdd_v1_GetAssembledPromptResponse, _tdd_v1_GetAssembledPromptResponse__Output>
      ReportUserQuestionPromptRequest: MessageTypeDefinition<_tdd_v1_ReportUserQuestionPromptRequest, _tdd_v1_ReportUserQuestionPromptRequest__Output>
      ReportUserQuestionPromptResponse: MessageTypeDefinition<_tdd_v1_ReportUserQuestionPromptResponse, _tdd_v1_ReportUserQuestionPromptResponse__Output>
      TddOpenmaicService: SubtypeConstructor<typeof grpc.Client, _tdd_v1_TddOpenmaicServiceClient> & { service: _tdd_v1_TddOpenmaicServiceDefinition }
    }
  }
}

