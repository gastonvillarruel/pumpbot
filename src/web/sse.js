/**
 * src/web/sse.js
 * Gestor de Server-Sent Events (SSE) para push de datos al browser.
 */

export class SSEManager {
  constructor() {
    this._clients = new Set();
  }

  /**
   * Registra una nueva conexión SSE.
   * @param {import('express').Response} res
   */
  addClient(res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    this._clients.add(res);
    res.on('close', () => this._clients.delete(res));
  }

  /**
   * Envía datos a todos los clientes conectados.
   * @param {string} event - Nombre del evento SSE.
   * @param {object} data
   */
  broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this._clients) {
      client.write(payload);
    }
  }

  get clientCount() {
    return this._clients.size;
  }
}
