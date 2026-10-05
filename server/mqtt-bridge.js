/**
 * MQTT bridge for Bomberman Oplà pads.
 */

const mqtt = require('mqtt');

const DEFAULT_PREFIX = 'mercantec/bomberman/v1';

function topicJoin(prefix, pin) {
  return `${prefix}/${pin}/join`;
}

function topicJoinResp(prefix, pin, deviceId) {
  return `${prefix}/${pin}/join/resp/${deviceId}`;
}

function topicError(prefix, pin, deviceId) {
  return `${prefix}/${pin}/error/${deviceId}`;
}

function parseTopic(prefix, topic) {
  const base = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const joinRe = new RegExp(`^${esc}/([^/]+)/join$`);
  const actionRe = new RegExp(`^${esc}/([^/]+)/action/([^/]+)$`);
  const heartbeatRe = new RegExp(`^${esc}/([^/]+)/heartbeat/([^/]+)$`);

  let m = topic.match(joinRe);
  if (m) return { kind: 'join', pin: m[1] };

  m = topic.match(actionRe);
  if (m) return { kind: 'action', pin: m[1], playerId: m[2] };

  m = topic.match(heartbeatRe);
  if (m) return { kind: 'heartbeat', pin: m[1], playerId: m[2] };

  return null;
}

function startMqttBridge(controller, options = {}) {
  const enabled = process.env.MQTT_ENABLED === '1' || process.env.MQTT_ENABLED === 'true';
  if (!enabled) {
    console.log('[MQTT] Disabled (MQTT_ENABLED not set)');
    return null;
  }

  const url = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';
  const prefix = process.env.MQTT_TOPIC_PREFIX || DEFAULT_PREFIX;
  const username = process.env.MQTT_USERNAME || undefined;
  const password = process.env.MQTT_PASSWORD || undefined;

  const subscribeTopics = [
    `${prefix}/+/join`,
    `${prefix}/+/action/+`,
    `${prefix}/+/heartbeat/+`,
  ];

  const client = mqtt.connect(url, {
    username,
    password,
    reconnectPeriod: 5000,
    connectTimeout: 15000,
    ...options.clientOptions,
  });

  client.on('connect', () => {
    console.log('[MQTT] Connected to', url);
    client.subscribe(subscribeTopics, { qos: 1 }, (err) => {
      if (err) console.error('[MQTT] Subscribe error:', err.message);
      else console.log('[MQTT] Subscribed:', subscribeTopics.join(', '));
    });
  });

  client.on('reconnect', () => console.log('[MQTT] Reconnecting…'));
  client.on('error', (err) => console.error('[MQTT] Error:', err.message));

  client.on('message', (topic, payload) => {
    let msg;
    try {
      msg = JSON.parse(payload.toString());
    } catch {
      console.warn('[MQTT] Invalid JSON on', topic);
      return;
    }

    const parsed = parseTopic(prefix, topic);
    if (!parsed) return;

    if (parsed.kind === 'join') {
      const deviceId = msg.deviceId ? String(msg.deviceId) : null;
      const name = msg.name;
      const result = controller.controllerJoin(parsed.pin, { name, deviceId });
      const body = result.body;
      if (deviceId) {
        const outTopic =
          result.status >= 200 && result.status < 300 && body.ok
            ? topicJoinResp(prefix, parsed.pin, deviceId)
            : topicError(prefix, parsed.pin, deviceId);
        client.publish(outTopic, JSON.stringify(body), { qos: 1 });
      } else if (!body.ok) {
        console.warn('[MQTT] Join without deviceId — cannot publish response');
      }
      return;
    }

    if (parsed.kind === 'heartbeat') {
      controller.controllerHeartbeat(parsed.pin, parsed.playerId);
      return;
    }

    if (parsed.kind === 'action') {
      const result = controller.controllerAction(parsed.pin, parsed.playerId, {
        action: msg.action,
        direction: msg.direction,
        params: msg.params,
      });
      if (result.status >= 400 && msg.deviceId) {
        client.publish(
          topicError(prefix, parsed.pin, String(msg.deviceId)),
          JSON.stringify(result.body),
          { qos: 1 }
        );
      }
    }
  });

  return client;
}

module.exports = { startMqttBridge, parseTopic, DEFAULT_PREFIX };
