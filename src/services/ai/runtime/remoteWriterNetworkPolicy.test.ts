import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPrivateOrLoopbackHost,
  validateGatewayConfig,
  validateRemoteWriterConfig,
} from '../realAiClient';
import {
  getDefaultGatewaySettings,
  getDefaultRemoteWriterSettings,
  normalizeAiSettings,
} from '../aiSettingsStore';
import { createProviderAdapter } from '../providerAdapter';
import type { AiSettings } from '../../../types/ai';

test('isPrivateOrLoopbackHost accurately identifies private, loopback and VPC addresses', () => {
  // Loopback
  assert.equal(isPrivateOrLoopbackHost('localhost'), true);
  assert.equal(isPrivateOrLoopbackHost('127.0.0.1'), true);
  assert.equal(isPrivateOrLoopbackHost('127.10.20.30'), true);
  assert.equal(isPrivateOrLoopbackHost('::1'), true);
  assert.equal(isPrivateOrLoopbackHost('[::1]'), true);

  // RFC 1918 Class A (10.0.0.0/8)
  assert.equal(isPrivateOrLoopbackHost('10.0.0.1'), true);
  assert.equal(isPrivateOrLoopbackHost('10.254.12.34'), true);

  // RFC 1918 Class B (172.16.0.0/12)
  assert.equal(isPrivateOrLoopbackHost('172.16.0.1'), true);
  assert.equal(isPrivateOrLoopbackHost('172.31.255.254'), true);
  assert.equal(isPrivateOrLoopbackHost('172.15.255.255'), false); // public
  assert.equal(isPrivateOrLoopbackHost('172.32.0.1'), false); // public

  // RFC 1918 Class C (192.168.0.0/16)
  assert.equal(isPrivateOrLoopbackHost('192.168.0.1'), true);
  assert.equal(isPrivateOrLoopbackHost('192.168.100.50'), true);
  assert.equal(isPrivateOrLoopbackHost('192.169.1.1'), false); // public

  // RFC 6598 CGNAT (100.64.0.0/10) - frequently used in VPC & cloud internal networks
  assert.equal(isPrivateOrLoopbackHost('100.64.0.1'), true);
  assert.equal(isPrivateOrLoopbackHost('100.100.50.20'), true);
  assert.equal(isPrivateOrLoopbackHost('100.127.255.254'), true);
  assert.equal(isPrivateOrLoopbackHost('100.63.255.255'), false); // public
  assert.equal(isPrivateOrLoopbackHost('100.128.0.1'), false); // public

  // Link-Local (169.254.0.0/16)
  assert.equal(isPrivateOrLoopbackHost('169.254.1.1'), true);

  // Internal / local domains
  assert.equal(isPrivateOrLoopbackHost('writer.local'), true);
  assert.equal(isPrivateOrLoopbackHost('gpu-node.internal'), true);
  assert.equal(isPrivateOrLoopbackHost('model-service.lan'), true);

  // Public domains and IPs
  assert.equal(isPrivateOrLoopbackHost('api.openai.com'), false);
  assert.equal(isPrivateOrLoopbackHost('api.deepseek.com'), false);
  assert.equal(isPrivateOrLoopbackHost('8.8.8.8'), false);
  assert.equal(isPrivateOrLoopbackHost('1.1.1.1'), false);
});

test('validateGatewayConfig enforces HTTPS for public endpoints and allows HTTP for private VPC', () => {
  // Valid public HTTPS
  assert.doesNotThrow(() =>
    validateGatewayConfig({
      baseUrl: 'https://api.writer-cluster.com/v1',
      apiKey: 'secret-token-123',
      modelName: 'qwen35-32b-novel-v1',
    }),
  );

  // Invalid public HTTP -> must reject
  assert.throws(
    () =>
      validateGatewayConfig({
        baseUrl: 'http://api.writer-cluster.com/v1',
        apiKey: 'secret-token-123',
        modelName: 'qwen35-32b-novel-v1',
      }),
    /公网 AI Gateway Endpoint 必须使用 HTTPS 协议以保证通信安全/,
  );

  // Valid private HTTP (10.x, 192.168.x, 172.16-31.x, 100.64.x, localhost)
  assert.doesNotThrow(() =>
    validateGatewayConfig({
      baseUrl: 'http://10.0.1.50:8000/v1',
      apiKey: 'secret-vpc-key',
      modelName: 'qwen35-32b-novel-v1',
    }),
  );
  assert.doesNotThrow(() =>
    validateGatewayConfig({
      baseUrl: 'http://192.168.1.100:8000/v1',
      apiKey: 'secret-vpc-key',
      modelName: 'qwen35-32b-novel-v1',
    }),
  );
  assert.doesNotThrow(() =>
    validateGatewayConfig({
      baseUrl: 'http://100.64.10.20:8000/v1',
      apiKey: 'secret-vpc-key',
      modelName: 'qwen35-32b-novel-v1',
    }),
  );
  assert.doesNotThrow(() =>
    validateGatewayConfig({
      baseUrl: 'http://writer-gpu.internal:8000/v1',
      apiKey: 'secret-vpc-key',
      modelName: 'qwen35-32b-novel-v1',
    }),
  );

  // Empty or missing API Key must be rejected (no anonymous calls)
  assert.throws(
    () =>
      validateGatewayConfig({
        baseUrl: 'http://10.0.1.50:8000/v1',
        apiKey: '',
        modelName: 'qwen35-32b-novel-v1',
      }),
    /必须配置鉴权 Token \/ API Key，不允许匿名调用/,
  );
  assert.throws(
    () =>
      validateGatewayConfig({
        baseUrl: 'http://10.0.1.50:8000/v1',
        apiKey: '   ',
        modelName: 'qwen35-32b-novel-v1',
      }),
    /必须配置鉴权 Token \/ API Key，不允许匿名调用/,
  );

  // validateRemoteWriterConfig backward-compatibility alias
  assert.doesNotThrow(() =>
    validateRemoteWriterConfig({
      baseUrl: 'https://api.writer-cluster.com/v1',
      apiKey: 'secret-token-123',
      modelName: 'qwen35-32b-novel-v1',
    }),
  );
});

test('getDefaultGatewaySettings and alias return safe disabled defaults', () => {
  const defaults = getDefaultGatewaySettings();
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.providerId, 'ai_gateway');
  assert.equal(defaults.contextTokens, 32000);
  assert.equal(defaults.maxTokens, 4000);

  const aliasDefaults = getDefaultRemoteWriterSettings();
  assert.equal(aliasDefaults.enabled, false);
});

test('normalizeAiSettings correctly processes gateway settings and auto-migrates remoteWriter', () => {
  const normalized = normalizeAiSettings({
    remoteWriter: {
      enabled: true,
      providerId: 'my_remote_writer',
      baseUrl: 'https://api.my-writer.com/v1',
      apiKey: 'token',
      modelName: 'qwen35-32b',
      timeoutSeconds: 300,
      contextTokens: 64000,
      maxTokens: 8000,
      temperature: 0.8,
      topP: 0.9,
      topK: 40,
      repeatPenalty: 1.1,
    },
  });

  assert.equal(normalized.gateway?.enabled, true);
  assert.equal(normalized.remoteWriter?.enabled, true);
  assert.equal(normalized.gateway?.providerId, 'my_remote_writer');
  assert.equal(normalized.gateway?.contextTokens, 64000);
  assert.equal(normalized.gateway?.maxTokens, 8000);
  assert.equal(normalized.gateway?.temperature, 0.8);
});

test('createProviderAdapter enforces gateway routing contracts', () => {
  const settings: AiSettings = {
    runtimeMode: 'api',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-cloud',
    modelName: 'deepseek-chat',
    mockMode: false,
    gateway: {
      enabled: true,
      providerId: 'ai_gateway',
      baseUrl: 'https://api.remote-writer.com/v1',
      apiKey: 'sk-remote',
      modelName: 'qwen35-32b-novel-v1',
      timeoutSeconds: 120,
      contextTokens: 32000,
      maxTokens: 4000,
      temperature: 0.7,
      topP: 0.8,
      topK: 20,
      repeatPenalty: 1.08,
    },
  };

  const adapter = createProviderAdapter(settings, 'chapter_scene_generate', {
    selected: {
      endpointId: 'remote.ai_gateway.qwen35-32b-novel-v1',
      providerId: 'ai_gateway',
      modelId: 'qwen35-32b-novel-v1',
      kind: 'remote',
    },
  });

  assert.equal(adapter.providerId, 'ai_gateway');
  assert.equal(adapter.modelId, 'qwen35-32b-novel-v1');
});
