import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import {
  completeDurableCapabilityExecution,
  completeDurableOperationPlanExecution,
  completeDurableProviderProbeExecution,
  failDurableHostExecution,
  getDurableHostExecution,
  listDurableHostExecutions,
  prepareDurableCapabilityExecution,
  prepareDurableOperationPlanExecution,
  prepareDurableProviderProbeExecution
} from '../service.mjs';

const jsonObject = z.record(z.string(), z.unknown());
const resultSchema = { result: jsonObject };
const statefulAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
};
const completionAnnotations = {
  ...statefulAnnotations,
  idempotentHint: true
};
const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

function result(value, summary) {
  const structuredContent = { result: value };
  return {
    content: [{ type: 'text', text: summary + '\n' + JSON.stringify(value, null, 2) }],
    structuredContent
  };
}

export function createSoterMcpServer({ root, host }) {
  if (!host) throw new Error('Soter MCP server requires an active host identity.');
  const server = new McpServer(
    { name: 'soter-core', version: '0.1.0' },
    {
      instructions: 'Soter Core validates exact locks and runs for the active ' + host + ' host projection, then saves a private durable checkpoint before emitting a provider-neutral operation resolved to an exact native host tool. After compaction or restart, use soter_list_host_calls and soter_get_host_call to recover pending work. For a one-call checkpoint, invoke exactly checkpoint.call.transport.tool. For an operation plan, invoke exactly currentCall.transport.tool and return both checkpoint.id and currentCall.id; a successful completion may emit the next exact call. Always pass the requested arguments through the separately configured provider MCP route and return the native result unchanged. Never fabricate a provider response. Soter does not invoke providers, persist raw responses, or authorize connected writes.'
    }
  );

  server.registerTool('soter_prepare_provider_probe', {
    title: 'Prepare Soter provider probe',
    description: 'Validate an exact configuration lock, durably checkpoint it, and emit one identity-minimized provider operation resolved to an exact native host tool. This tool does not call the provider.',
    inputSchema: {
      lock_path: z.string().min(1),
      provider_implementation: z.string().min(1),
      call_id: z.string().min(1).optional(),
      probe_id: z.string().min(1).optional(),
      at: z.string().min(20).optional(),
      valid_for_seconds: z.number().int().min(60).max(900).optional()
    },
    outputSchema: resultSchema,
    annotations: statefulAnnotations
  }, async (input) => {
    const prepared = await prepareDurableProviderProbeExecution({
      root,
      lockPath: input.lock_path,
      providerImplementation: input.provider_implementation,
      callId: input.call_id,
      probeId: input.probe_id,
      at: input.at,
      validForSeconds: input.valid_for_seconds,
      expectedHost: host
    });
    return result(prepared, 'Durably checkpointed a Soter provider probe request; no provider call was executed.');
  });

  server.registerTool('soter_complete_provider_probe', {
    title: 'Complete Soter provider probe',
    description: 'Resume a durable provider probe checkpoint, validate and minimize the native result, and atomically close the checkpoint without persisting the raw response.',
    inputSchema: {
      checkpoint_id: z.string().min(1),
      response: jsonObject,
      at: z.string().min(20).optional()
    },
    outputSchema: resultSchema,
    annotations: completionAnnotations
  }, async (input) => {
    const completed = await completeDurableProviderProbeExecution({
      root,
      checkpointId: input.checkpoint_id,
      response: input.response,
      at: input.at,
      expectedHost: host
    });
    return result(completed, 'Validated and minimized the provider probe result.');
  });

  server.registerTool('soter_prepare_capability_call', {
    title: 'Prepare Soter capability call',
    description: 'Validate and durably checkpoint an exact run before emitting one policy-bound provider operation resolved to an exact native host tool. This interface supplies no connected-write approval.',
    inputSchema: {
      lock_path: z.string().min(1),
      run_path: z.string().min(1),
      capability: z.string().min(1),
      authority: z.string().min(1),
      provider_implementation: z.string().min(1),
      input: jsonObject,
      call_id: z.string().min(1).optional(),
      at: z.string().min(20).optional()
    },
    outputSchema: resultSchema,
    annotations: statefulAnnotations
  }, async (input) => {
    const prepared = await prepareDurableCapabilityExecution({
      root,
      lockPath: input.lock_path,
      runPath: input.run_path,
      capability: input.capability,
      authority: input.authority,
      providerImplementation: input.provider_implementation,
      input: input.input,
      callId: input.call_id,
      at: input.at,
      expectedHost: host
    });
    return result(prepared, 'Durably checkpointed a policy-bound Soter capability request; no provider call was executed.');
  });

  server.registerTool('soter_complete_capability_call', {
    title: 'Complete Soter capability call',
    description: 'Resume a durable capability checkpoint, validate the native result against its exact run and request, then checkpoint normalized portable output without the raw response.',
    inputSchema: {
      checkpoint_id: z.string().min(1),
      response: jsonObject,
      at: z.string().min(20).optional()
    },
    outputSchema: resultSchema,
    annotations: completionAnnotations
  }, async (input) => {
    const completed = await completeDurableCapabilityExecution({
      root,
      checkpointId: input.checkpoint_id,
      response: input.response,
      at: input.at,
      expectedHost: host
    });
    return result(completed, 'Validated and normalized the provider capability result.');
  });

  server.registerTool('soter_prepare_operation_plan', {
    title: 'Prepare Soter operation plan',
    description: 'Validate and durably checkpoint an exact sequential capability plan, then emit only its first policy-bound native host call. This interface supplies no connected-write approval.',
    inputSchema: {
      lock_path: z.string().min(1),
      run_path: z.string().min(1),
      plan: jsonObject,
      at: z.string().min(20).optional()
    },
    outputSchema: resultSchema,
    annotations: statefulAnnotations
  }, async (input) => {
    const prepared = await prepareDurableOperationPlanExecution({
      root,
      lockPath: input.lock_path,
      runPath: input.run_path,
      plan: input.plan,
      at: input.at,
      expectedHost: host
    });
    return result(prepared, 'Durably checkpointed an exact sequential operation plan and emitted at most one native host call.');
  });

  server.registerTool('soter_complete_operation_plan', {
    title: 'Advance Soter operation plan',
    description: 'Complete the exact current plan call, persist only normalized output, and atomically emit the next policy-bound call or close the plan.',
    inputSchema: {
      checkpoint_id: z.string().min(1),
      call_id: z.string().min(1),
      response: jsonObject,
      at: z.string().min(20).optional()
    },
    outputSchema: resultSchema,
    annotations: completionAnnotations
  }, async (input) => {
    const completed = await completeDurableOperationPlanExecution({
      root,
      checkpointId: input.checkpoint_id,
      callId: input.call_id,
      response: input.response,
      at: input.at,
      expectedHost: host
    });
    return result(completed, 'Advanced the exact operation plan without persisting the native provider response.');
  });

  server.registerTool('soter_fail_host_call', {
    title: 'Record Soter host call failure',
    description: 'Close an exact durable probe or capability checkpoint as failed when the host could not obtain a native provider result.',
    inputSchema: {
      checkpoint_id: z.string().min(1),
      error_kind: z.enum([
        'authentication',
        'authorization',
        'validation',
        'conflict',
        'rate-limit',
        'unavailable',
        'retryable',
        'not-found',
        'unknown'
      ]),
      message: z.string().min(1),
      call_id: z.string().min(1).optional(),
      at: z.string().min(20).optional()
    },
    outputSchema: resultSchema,
    annotations: completionAnnotations
  }, async (input) => {
    const failed = failDurableHostExecution({
      root,
      checkpointId: input.checkpoint_id,
      errorKind: input.error_kind,
      message: input.message,
      callId: input.call_id,
      at: input.at,
      expectedHost: host
    });
    return result(failed, 'Recorded the exact host request as failed; no provider call was executed.');
  });

  server.registerTool('soter_get_host_call', {
    title: 'Get Soter host call checkpoint',
    description: 'Rehydrate one private durable host call checkpoint by ID without contacting a provider.',
    inputSchema: {
      checkpoint_id: z.string().min(1)
    },
    outputSchema: resultSchema,
    annotations: readAnnotations
  }, async (input) => {
    const checkpoint = getDurableHostExecution({
      root,
      checkpointId: input.checkpoint_id,
      expectedHost: host
    });
    return result(checkpoint, 'Loaded the durable Soter host call checkpoint.');
  });

  server.registerTool('soter_list_host_calls', {
    title: 'List Soter host call checkpoints',
    description: 'List private durable host call checkpoint summaries for recovery; normalized results are omitted from the list view.',
    inputSchema: {
      state: z.enum(['requested', 'completed', 'failed', 'blocked']).optional()
    },
    outputSchema: resultSchema,
    annotations: readAnnotations
  }, async (input) => {
    const checkpoints = listDurableHostExecutions({
      root,
      state: input.state,
      expectedHost: host
    });
    return result(checkpoints, 'Listed durable Soter host call checkpoints.');
  });

  return server;
}
