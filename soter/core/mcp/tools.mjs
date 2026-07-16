import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import {
  completeCapabilityExecution,
  completeProviderProbeExecution,
  failHostExecution,
  prepareCapabilityExecution,
  prepareProviderProbeExecution
} from '../service.mjs';

const jsonObject = z.record(z.string(), z.unknown());
const resultSchema = { result: jsonObject };
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
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
      instructions: 'Soter Core validates exact locks and runs for the active ' + host + ' host projection, then emits logical provider requests. Call a prepare tool first. Only when its call.state is requested, invoke exactly call.transport.server/call.transport.tool with call.arguments through the separately configured provider MCP server. Pass the native provider result unchanged to the matching complete tool. Never fabricate a provider response. These tools do not invoke providers, store raw responses, or authorize connected writes.'
    }
  );

  server.registerTool('soter_prepare_provider_probe', {
    title: 'Prepare Soter provider probe',
    description: 'Validate an exact configuration lock and emit one logical, identity-minimized provider probe request. This tool does not call the provider.',
    inputSchema: {
      lock_path: z.string().min(1),
      provider_implementation: z.string().min(1),
      call_id: z.string().min(1).optional(),
      probe_id: z.string().min(1).optional(),
      at: z.string().min(20).optional(),
      valid_for_seconds: z.number().int().min(60).max(900).optional()
    },
    outputSchema: resultSchema,
    annotations
  }, async (input) => {
    const prepared = await prepareProviderProbeExecution({
      root,
      lockPath: input.lock_path,
      providerImplementation: input.provider_implementation,
      callId: input.call_id,
      probeId: input.probe_id,
      at: input.at,
      validForSeconds: input.valid_for_seconds,
      expectedHost: host
    });
    return result(prepared, 'Prepared a Soter provider probe request; no provider call was executed.');
  });

  server.registerTool('soter_complete_provider_probe', {
    title: 'Complete Soter provider probe',
    description: 'Validate and minimize a native provider probe result against the exact request and lock. Core retains fingerprints and typed observations, not the raw response.',
    inputSchema: {
      lock_path: z.string().min(1),
      call: jsonObject,
      response: jsonObject,
      at: z.string().min(20).optional()
    },
    outputSchema: resultSchema,
    annotations
  }, async (input) => {
    const completed = await completeProviderProbeExecution({
      root,
      lockPath: input.lock_path,
      call: input.call,
      response: input.response,
      at: input.at,
      expectedHost: host
    });
    return result(completed, 'Validated and minimized the provider probe result.');
  });

  server.registerTool('soter_prepare_capability_call', {
    title: 'Prepare Soter capability call',
    description: 'Validate an exact run and emit one policy-bound logical provider request. This interface supplies no connected-write approval, so confirmation-gated writes remain blocked.',
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
    annotations
  }, async (input) => {
    const prepared = await prepareCapabilityExecution({
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
    return result(prepared, 'Prepared a policy-bound Soter capability request; no provider call was executed.');
  });

  server.registerTool('soter_complete_capability_call', {
    title: 'Complete Soter capability call',
    description: 'Validate a native provider result against the exact run, lock, input, provider, and request, then return normalized portable output without the raw response.',
    inputSchema: {
      lock_path: z.string().min(1),
      run_path: z.string().min(1),
      call: jsonObject,
      input: jsonObject,
      response: jsonObject,
      at: z.string().min(20).optional()
    },
    outputSchema: resultSchema,
    annotations
  }, async (input) => {
    const completed = await completeCapabilityExecution({
      root,
      lockPath: input.lock_path,
      runPath: input.run_path,
      call: input.call,
      input: input.input,
      response: input.response,
      at: input.at,
      expectedHost: host
    });
    return result(completed, 'Validated and normalized the provider capability result.');
  });

  server.registerTool('soter_fail_host_call', {
    title: 'Record Soter host call failure',
    description: 'Close an exact requested probe or capability call as failed when the host could not obtain a native provider result. Capability failures require the exact run path.',
    inputSchema: {
      lock_path: z.string().min(1),
      run_path: z.string().min(1).optional(),
      call: jsonObject,
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
      at: z.string().min(20).optional()
    },
    outputSchema: resultSchema,
    annotations
  }, async (input) => {
    const failed = failHostExecution({
      root,
      lockPath: input.lock_path,
      runPath: input.run_path,
      call: input.call,
      errorKind: input.error_kind,
      message: input.message,
      at: input.at,
      expectedHost: host
    });
    return result(failed, 'Recorded the exact host request as failed; no provider call was executed.');
  });

  return server;
}
