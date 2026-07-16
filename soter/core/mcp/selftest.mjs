#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const codeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const lockPath = 'soter/fixtures/meeting-intake/meeting-intake.lock.json';
const runPath = 'soter/fixtures/meeting-intake/preflight.run.json';
const completedRunPath = 'soter/fixtures/meeting-intake/transaction.run.json';
const fixtureTime = '2026-07-15T12:00:00.000Z';

function createFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soter-mcp-'));
  fs.cpSync(path.join(codeRoot, 'soter'), path.join(root, 'soter'), { recursive: true });
  fs.cpSync(path.join(codeRoot, '.codex'), path.join(root, '.codex'), { recursive: true });
  fs.cpSync(path.join(codeRoot, '.claude'), path.join(root, '.claude'), { recursive: true });
  for (const file of ['AGENTS.md', 'CLAUDE.md', 'package.json', 'package-lock.json']) {
    fs.copyFileSync(path.join(codeRoot, file), path.join(root, file));
  }
  return root;
}

async function connectClient(root, host = 'codex') {
  const client = new Client({ name: 'soter-core-selftest', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.join(codeRoot, 'soter/core/mcp/server.mjs'),
      '--root',
      root,
      '--host',
      host
    ],
    cwd: root,
    stderr: 'pipe'
  });
  await client.connect(transport);
  return client;
}

function toolResult(response) {
  if (response.isError) {
    throw new Error('MCP tool returned an error: ' + JSON.stringify(response.content));
  }
  return response.structuredContent?.result;
}

async function call(client, name, args) {
  return toolResult(await client.callTool({ name, arguments: args }));
}

async function expectToolError(client, name, args, message) {
  const response = await client.callTool({ name, arguments: args });
  if (!response.isError || !JSON.stringify(response.content).includes(message)) {
    throw new Error(name + ' did not fail with expected diagnostic: ' + message);
  }
}

function checkpointFile(root, prepared) {
  return path.join(root, prepared.checkpointPath);
}

function assertPrivateFile(file) {
  if (!fs.existsSync(file)) throw new Error('Durable private state file is missing: ' + file);
  if (process.platform !== 'win32' && (fs.statSync(file).mode & 0o777) !== 0o600) {
    throw new Error('Durable private state file does not use mode 0600: ' + file);
  }
}

function invokeCli(root, args) {
  return spawnSync(
    process.execPath,
    [path.join(codeRoot, 'soter/core/cli.mjs'), ...args, '--root', root, '--json'],
    { cwd: root, encoding: 'utf8' }
  );
}

function runCli(root, args) {
  const invoked = invokeCli(root, args);
  if (invoked.status !== 0) {
    throw new Error('CLI projection failed: ' + (invoked.stderr || invoked.stdout));
  }
  return JSON.parse(invoked.stdout);
}

async function assertWrongHostRejected(root) {
  const client = await connectClient(root, 'claude');
  try {
    await expectToolError(client, 'soter_prepare_provider_probe', {
      lock_path: lockPath,
      provider_implementation: 'provider.integration.otter.mcp',
      at: fixtureTime
    }, 'does not match the active host projection claude');
  } finally {
    await client.close().catch(() => {});
  }
}

async function selftest(root) {
  let client = await connectClient(root);
  let preparedCapability;
  let requestedRunContents;
  const privateInputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soter-mcp-response-'));
  try {
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    const expectedNames = [
      'soter_complete_capability_call',
      'soter_complete_provider_probe',
      'soter_fail_host_call',
      'soter_get_host_call',
      'soter_list_host_calls',
      'soter_prepare_capability_call',
      'soter_prepare_provider_probe'
    ];
    if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
      throw new Error('Unexpected Soter MCP tools: ' + names.join(', '));
    }
    if (listed.tools.some((tool) => JSON.stringify(tool.inputSchema).includes('approved_effects'))) {
      throw new Error('The MCP projection exposed generic connected-write approval input.');
    }
    if (!client.getInstructions()?.includes('soter_list_host_calls')) {
      throw new Error('The MCP server did not project durable recovery instructions.');
    }

    await expectToolError(client, 'soter_prepare_capability_call', {
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
    }, 'cannot continue this host request');

    const preparedProbe = await call(client, 'soter_prepare_provider_probe', {
      lock_path: lockPath,
      provider_implementation: 'provider.integration.otter.mcp',
      call_id: 'probecall.mcp-selftest.otter',
      probe_id: 'probe.mcp-selftest.otter',
      at: fixtureTime,
      valid_for_seconds: 300
    });
    if (preparedProbe.checkpoint?.state !== 'requested'
      || preparedProbe.checkpoint?.call?.transport?.server !== 'otter'
      || preparedProbe.checkpoint?.call?.transport?.operation !== 'get_user_info'
      || preparedProbe.checkpoint?.call?.transport?.tool !== 'mcp__otter__get_user_info'
      || JSON.stringify(preparedProbe.checkpoint?.call?.arguments) !== '{}') {
      throw new Error('Provider probe preparation did not persist the exact Otter request.');
    }
    assertPrivateFile(checkpointFile(root, preparedProbe));

    const privateIdentity = 'private-identity-mcp-selftest-marker';
    const completedProbe = await call(client, 'soter_complete_provider_probe', {
      checkpoint_id: preparedProbe.checkpoint.id,
      response: { structuredContent: { result: privateIdentity } },
      at: fixtureTime
    });
    if (completedProbe.checkpoint?.state !== 'completed'
      || completedProbe.checkpoint?.result?.capabilities?.[0]?.state !== 'unknown'
      || JSON.stringify(completedProbe).includes(privateIdentity)
      || fs.readFileSync(checkpointFile(root, completedProbe), 'utf8').includes(privateIdentity)) {
      throw new Error('Provider probe completion did not minimize durable identity evidence.');
    }
    const repeatedProbe = await call(client, 'soter_complete_provider_probe', {
      checkpoint_id: preparedProbe.checkpoint.id,
      response: { structuredContent: { result: privateIdentity } },
      at: fixtureTime
    });
    if (repeatedProbe.checkpoint.checkpointFingerprint
      !== completedProbe.checkpoint.checkpointFingerprint) {
      throw new Error('Repeating an identical provider result was not idempotent.');
    }

    const failedProbeRequest = await call(client, 'soter_prepare_provider_probe', {
      lock_path: lockPath,
      provider_implementation: 'provider.integration.otter.mcp',
      call_id: 'probecall.mcp-selftest.failure',
      probe_id: 'probe.mcp-selftest.failure',
      at: fixtureTime
    });
    const failedProbe = await call(client, 'soter_fail_host_call', {
      checkpoint_id: failedProbeRequest.checkpoint.id,
      error_kind: 'authentication',
      message: 'The host could not authenticate the provider request.',
      at: fixtureTime
    });
    if (failedProbe.checkpoint?.state !== 'failed'
      || failedProbe.checkpoint?.call?.error?.kind !== 'authentication') {
      throw new Error('Host failure recording did not close the durable provider request.');
    }

    const staleProbe = await call(client, 'soter_prepare_provider_probe', {
      lock_path: lockPath,
      provider_implementation: 'provider.integration.otter.mcp',
      call_id: 'probecall.mcp-selftest.stale',
      probe_id: 'probe.mcp-selftest.stale',
      at: fixtureTime
    });
    const providerModule = path.join(root, 'soter/integrations/otter/mcp.mjs');
    const providerSource = fs.readFileSync(providerModule, 'utf8');
    try {
      fs.writeFileSync(providerModule, providerSource + '\n// planted stale-state change\n');
      await expectToolError(client, 'soter_complete_provider_probe', {
        checkpoint_id: staleProbe.checkpoint.id,
        response: { structuredContent: { result: 'private-stale-identity' } },
        at: fixtureTime
      }, 'Configuration lock is stale');
    } finally {
      fs.writeFileSync(providerModule, providerSource);
    }
    await call(client, 'soter_fail_host_call', {
      checkpoint_id: staleProbe.checkpoint.id,
      error_kind: 'unavailable',
      message: 'The stale-state selftest restored the exact provider implementation.',
      at: fixtureTime
    });

    const capabilityInput = {
      meetingId: 'meeting.mcp-selftest',
      recordingUri: 'https://otter.ai/u/conversation_mcp_selftest'
    };
    preparedCapability = await call(client, 'soter_prepare_capability_call', {
      lock_path: lockPath,
      run_path: runPath,
      capability: 'meeting.transcript.read',
      authority: 'authority.otter.provider',
      provider_implementation: 'provider.integration.otter.mcp',
      input: capabilityInput,
      call_id: 'toolcall.mcp-selftest.otter-read',
      at: fixtureTime
    });
    if (preparedCapability.checkpoint?.state !== 'requested'
      || preparedCapability.checkpoint?.call?.transport?.server !== 'otter'
      || preparedCapability.checkpoint?.call?.transport?.operation !== 'fetch'
      || preparedCapability.checkpoint?.call?.transport?.tool !== 'mcp__otter__fetch'
      || preparedCapability.checkpoint?.call?.arguments?.id !== 'conversation_mcp_selftest'
      || preparedCapability.run?.lifecycleState !== 'executing') {
      throw new Error('Capability preparation did not durably stage the exact Otter request.');
    }
    assertPrivateFile(checkpointFile(root, preparedCapability));
    assertPrivateFile(path.join(root, preparedCapability.runPath));
    requestedRunContents = fs.readFileSync(path.join(root, preparedCapability.runPath), 'utf8');

    const pending = await call(client, 'soter_list_host_calls', { state: 'requested' });
    if (!pending.checkpoints.some((item) => item.id === preparedCapability.checkpoint.id)) {
      throw new Error('Pending host call listing omitted the durable capability checkpoint.');
    }
    const loaded = await call(client, 'soter_get_host_call', {
      checkpoint_id: preparedCapability.checkpoint.id
    });
    if (loaded.checkpoint.checkpointFingerprint
      !== preparedCapability.checkpoint.checkpointFingerprint) {
      throw new Error('Host call rehydration changed the durable checkpoint.');
    }
    await expectToolError(client, 'soter_prepare_capability_call', {
      lock_path: lockPath,
      run_path: runPath,
      capability: 'meeting.transcript.read',
      authority: 'authority.otter.provider',
      provider_implementation: 'provider.integration.otter.mcp',
      input: capabilityInput,
      call_id: 'toolcall.mcp-selftest.parallel-read',
      at: fixtureTime
    }, 'already has pending host call checkpoint');

    fs.copyFileSync(path.join(root, runPath), path.join(root, preparedCapability.runPath));
  } finally {
    await client.close().catch(() => {});
  }

  client = await connectClient(root);
  try {
    const recovered = await call(client, 'soter_get_host_call', {
      checkpoint_id: preparedCapability.checkpoint.id
    });
    if (recovered.checkpoint.state !== 'requested') {
      throw new Error('Restarted MCP server did not recover the pending checkpoint.');
    }
    const privateTranscript = 'private-transcript-mcp-selftest-marker';
    const response = {
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
    };
    const completed = await call(client, 'soter_complete_capability_call', {
      checkpoint_id: preparedCapability.checkpoint.id,
      response,
      at: fixtureTime
    });
    if (completed.checkpoint?.state !== 'completed'
      || completed.checkpoint?.result?.meetingId !== 'meeting.mcp-selftest'
      || completed.run?.effects?.at(-1)?.state !== 'passed'
      || completed.run?.outputs?.at(-1)?.fingerprint
        !== completed.checkpoint.call.outputFingerprint
      || JSON.stringify(completed).includes(privateTranscript)) {
      throw new Error('Recovered capability completion did not update durable normalized state.');
    }
    const checkpointContents = fs.readFileSync(checkpointFile(root, completed), 'utf8');
    const runContents = fs.readFileSync(path.join(root, completed.runPath), 'utf8');
    if (checkpointContents.includes(privateTranscript) || runContents.includes(privateTranscript)) {
      throw new Error('Raw provider response content reached durable runtime state.');
    }
    fs.writeFileSync(path.join(root, completed.runPath), requestedRunContents, { mode: 0o600 });
    const repeated = await call(client, 'soter_complete_capability_call', {
      checkpoint_id: preparedCapability.checkpoint.id,
      response,
      at: fixtureTime
    });
    if (repeated.checkpoint.checkpointFingerprint
      !== completed.checkpoint.checkpointFingerprint
      || repeated.run?.effects?.at(-1)?.state !== 'passed') {
      throw new Error('Repeating an identical capability result was not idempotent.');
    }
    const remaining = await call(client, 'soter_list_host_calls', { state: 'requested' });
    if (remaining.checkpoints.some((item) => item.id === preparedCapability.checkpoint.id)) {
      throw new Error('Completed capability remained in the pending recovery list.');
    }

    await assertWrongHostRejected(root);

    const cliProbe = runCli(root, [
      'probe-prepare',
      '--lock', lockPath,
      '--provider', 'provider.integration.otter.mcp',
      '--call-id', 'probecall.cli-selftest.otter',
      '--probe-id', 'probe.cli-selftest.otter',
      '--at', fixtureTime
    ]);
    const cliIdentity = 'private-cli-identity-marker';
    const rejectedRepoResponse = invokeCli(root, [
      'probe-complete',
      '--checkpoint', cliProbe.checkpoint.id,
      '--response', path.join(root, 'soter/fixtures/meeting-intake/offline.doctor.json'),
      '--at', fixtureTime
    ]);
    if (rejectedRepoResponse.status === 0
      || !rejectedRepoResponse.stderr.includes('must remain outside the repository')) {
      throw new Error('CLI accepted a native provider response path inside the repository.');
    }
    const cliResponsePath = path.join(privateInputRoot, 'cli-probe-response.json');
    fs.writeFileSync(
      cliResponsePath,
      JSON.stringify({ structuredContent: { result: cliIdentity } }, null, 2) + '\n',
      { mode: 0o600 }
    );
    const cliCompleted = runCli(root, [
      'probe-complete',
      '--checkpoint', cliProbe.checkpoint.id,
      '--response', cliResponsePath,
      '--at', fixtureTime
    ]);
    if (cliCompleted.checkpoint.state !== 'completed'
      || JSON.stringify(cliCompleted).includes(cliIdentity)) {
      throw new Error('CLI projection drifted from durable Core probe completion.');
    }
    const doctorInvocation = invokeCli(root, [
      'doctor',
      '--lock', lockPath,
      '--level', 'connected',
      '--probe-checkpoint', cliCompleted.checkpoint.id,
      '--at', fixtureTime
    ]);
    const doctor = JSON.parse(doctorInvocation.stdout);
    if (doctorInvocation.status !== 1
      || doctor.states.valid !== 'passed'
      || doctor.states.ready !== 'failed'
      || !doctor.providerProbeIds.includes('probe.cli-selftest.otter')
      || doctor.diagnostics.some((item) => {
        return item.code === 'SOTER_PROVIDER_PROBE_MISSING'
          && item.subject === 'provider.integration.otter.mcp';
      })) {
      throw new Error('Connected doctor did not consume the durable provider probe checkpoint.');
    }

    const corruptFile = checkpointFile(root, completed);
    const corrupt = JSON.parse(fs.readFileSync(corruptFile, 'utf8'));
    corrupt.call.arguments.id = 'tampered-provider-id';
    fs.writeFileSync(corruptFile, JSON.stringify(corrupt, null, 2) + '\n');
    await expectToolError(client, 'soter_get_host_call', {
      checkpoint_id: completed.checkpoint.id
    }, 'fingerprint does not match');
  } finally {
    await client.close().catch(() => {});
    fs.rmSync(privateInputRoot, { recursive: true, force: true });
  }
}

const fixtureRoot = createFixtureRoot();
selftest(fixtureRoot)
  .then(() => {
    process.stdout.write('Soter MCP selftest: passed.\n');
  })
  .catch((error) => {
    process.stderr.write('Soter MCP selftest: ' + error.message + '\n');
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });
