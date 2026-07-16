#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const lockPath = 'soter/fixtures/meeting-intake/meeting-intake.lock.json';
const runPath = 'soter/fixtures/meeting-intake/preflight.run.json';
const completedRunPath = 'soter/fixtures/meeting-intake/transaction.run.json';
const fixtureTime = '2026-07-15T12:00:00.000Z';

function toolResult(response) {
  if (response.isError) {
    throw new Error('MCP tool returned an error: ' + JSON.stringify(response.content));
  }
  return response.structuredContent?.result;
}

async function call(client, name, args) {
  return toolResult(await client.callTool({ name, arguments: args }));
}

async function assertWrongHostRejected() {
  const client = new Client({ name: 'soter-host-binding-selftest', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['soter/core/mcp/server.mjs', '--host', 'claude'],
    cwd: root,
    stderr: 'pipe'
  });
  try {
    await client.connect(transport);
    const response = await client.callTool({
      name: 'soter_prepare_provider_probe',
      arguments: {
        lock_path: lockPath,
        provider_implementation: 'provider.integration.otter.mcp',
        at: fixtureTime
      }
    });
    if (!response.isError
      || !JSON.stringify(response.content).includes('does not match the active host projection claude')) {
      throw new Error('The host-bound MCP server accepted a lock resolved for a different host.');
    }
  } finally {
    await client.close().catch(() => {});
  }
}

async function selftest() {
  const client = new Client({ name: 'soter-core-selftest', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['soter/core/mcp/server.mjs', '--host', 'codex'],
    cwd: root,
    stderr: 'pipe'
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    const expectedNames = [
      'soter_complete_capability_call',
      'soter_complete_provider_probe',
      'soter_fail_host_call',
      'soter_prepare_capability_call',
      'soter_prepare_provider_probe'
    ];
    if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
      throw new Error('Unexpected Soter MCP tools: ' + names.join(', '));
    }
    if (listed.tools.some((tool) => JSON.stringify(tool.inputSchema).includes('approved_effects'))) {
      throw new Error('The MCP projection exposed generic connected-write approval input.');
    }
    if (!client.getInstructions()?.includes('Never fabricate a provider response')) {
      throw new Error('The MCP server did not project the resumable host workflow instructions.');
    }

    const closedRunResponse = await client.callTool({
      name: 'soter_prepare_capability_call',
      arguments: {
        lock_path: lockPath,
        run_path: completedRunPath,
        capability: 'meeting.transcript.read',
        authority: 'authority.otter.provider',
        provider_implementation: 'provider.integration.otter.mcp',
        input: {
          meetingId: 'meeting.closed-run',
          recordingUri: 'https://otter.ai/u/conversation_closed_run'
        },
        at: fixtureTime
      }
    });
    if (!closedRunResponse.isError
      || !JSON.stringify(closedRunResponse.content).includes('cannot emit a host request')) {
      throw new Error('The MCP projection emitted a provider request from a closed run.');
    }

    const preparedProbe = await call(client, 'soter_prepare_provider_probe', {
      lock_path: lockPath,
      provider_implementation: 'provider.integration.otter.mcp',
      call_id: 'probecall.mcp-selftest.otter',
      probe_id: 'probe.mcp-selftest.otter',
      at: fixtureTime,
      valid_for_seconds: 300
    });
    if (preparedProbe.call?.state !== 'requested'
      || preparedProbe.call?.transport?.server !== 'otter'
      || preparedProbe.call?.transport?.tool !== 'get_user_info'
      || JSON.stringify(preparedProbe.call?.arguments) !== '{}') {
      throw new Error('Provider probe preparation did not emit the exact logical Otter request.');
    }

    const privateIdentity = 'private-identity-mcp-selftest-marker';
    const completedProbe = await call(client, 'soter_complete_provider_probe', {
      lock_path: lockPath,
      call: preparedProbe.call,
      response: { structuredContent: { result: privateIdentity } },
      at: fixtureTime
    });
    if (completedProbe.call?.state !== 'completed'
      || completedProbe.probe?.capabilities?.[0]?.state !== 'unknown'
      || JSON.stringify(completedProbe).includes(privateIdentity)) {
      throw new Error('Provider probe completion did not minimize identity-only evidence.');
    }

    const capabilityInput = {
      meetingId: 'meeting.mcp-selftest',
      recordingUri: 'https://otter.ai/u/conversation_mcp_selftest'
    };
    const preparedCapability = await call(client, 'soter_prepare_capability_call', {
      lock_path: lockPath,
      run_path: runPath,
      capability: 'meeting.transcript.read',
      authority: 'authority.otter.provider',
      provider_implementation: 'provider.integration.otter.mcp',
      input: capabilityInput,
      call_id: 'toolcall.mcp-selftest.otter-read',
      at: fixtureTime
    });
    if (preparedCapability.call?.state !== 'requested'
      || preparedCapability.call?.transport?.server !== 'otter'
      || preparedCapability.call?.transport?.tool !== 'fetch'
      || preparedCapability.call?.arguments?.id !== 'conversation_mcp_selftest') {
      throw new Error('Capability preparation did not emit the exact logical Otter request.');
    }

    const privateTranscript = 'private-transcript-mcp-selftest-marker';
    const completedCapability = await call(client, 'soter_complete_capability_call', {
      lock_path: lockPath,
      run_path: runPath,
      call: preparedCapability.call,
      input: capabilityInput,
      response: {
        structuredContent: {
          result: {
            speakers: [{ id: 'speaker.mcp', displayName: 'MCP speaker' }],
            segments: [{
              speakerId: 'speaker.mcp',
              text: 'MCP transcript segment.',
              startSeconds: 0
            }],
            ignoredPrivateField: privateTranscript
          }
        }
      },
      at: fixtureTime
    });
    if (completedCapability.call?.state !== 'completed'
      || completedCapability.output?.meetingId !== capabilityInput.meetingId
      || JSON.stringify(completedCapability).includes(privateTranscript)) {
      throw new Error('Capability completion did not validate and minimize the native provider result.');
    }

    const failedProbeRequest = await call(client, 'soter_prepare_provider_probe', {
      lock_path: lockPath,
      provider_implementation: 'provider.integration.otter.mcp',
      call_id: 'probecall.mcp-selftest.failure',
      probe_id: 'probe.mcp-selftest.failure',
      at: fixtureTime
    });
    const failedProbe = await call(client, 'soter_fail_host_call', {
      lock_path: lockPath,
      call: failedProbeRequest.call,
      error_kind: 'authentication',
      message: 'The host could not authenticate the provider request.',
      at: fixtureTime
    });
    if (failedProbe.call?.state !== 'failed'
      || failedProbe.call?.error?.kind !== 'authentication') {
      throw new Error('Host failure recording did not close the exact provider request.');
    }

  } finally {
    await client.close().catch(() => {});
  }
  await assertWrongHostRejected();
  process.stdout.write('Soter MCP selftest: passed.\n');
}

selftest().catch((error) => {
  process.stderr.write('Soter MCP selftest: ' + error.message + '\n');
  process.exitCode = 1;
});
