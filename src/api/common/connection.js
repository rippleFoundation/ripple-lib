'use strict';
const {EventEmitter} = require('events');
const WebSocket = require('ws');

function isStreamMessageType(type) {
  return type === 'ledgerClosed' ||
         type === 'transaction' ||
         type === 'path_find';
}

class RippledError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
    this.message = message;
    Error.captureStackTrace(this, this.constructor.name);
  }
}

class ConnectionError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
    this.message = message;
    Error.captureStackTrace(this, this.constructor.name);
  }
}

class NotConnectedError extends ConnectionError {
  constructor(message) {
    super(message);
  }
}

class DisconnectedError extends ConnectionError {
  constructor(message) {
    super(message);
  }
}

class TimeoutError extends ConnectionError {
  constructor(message) {
    super(message);
  }
}

class UnexpectedError extends ConnectionError {
  constructor(message) {
    super(message);
  }
}

class Connection extends EventEmitter {
  constructor(url, options = {}) {
    super();
    this._url = url;
    this._timeout = options.timeout || (20 * 1000);
    this._ws = null;
    this._ledgerVersion = null;
    this._nextRequestID = 1;
  }

  _onMessage(message) {
    try {
      const data = JSON.parse(message);
      if (data.type === 'response') {
        if (!(Number.isInteger(data.id) && data.id >= 0)) {
          throw new UnexpectedError('valid id not found in response');
        }
        this.emit(data.id.toString(), data);
      } else if (isStreamMessageType(data.type)) {
        if (data.type === 'ledgerClosed') {
          this._ledgerVersion = Number(data.ledger_index);
        }
        this.emit(data.type, data);
      } else if (data.type === undefined && data.error) {
        this.emit('error', data.error, data.error_message);  // e.g. slowDown
      } else {
        throw new UnexpectedError('unrecognized message type: ' + data.type);
      }
    } catch (error) {
      this.emit('error', 'badMessage', message);
    }
  }

  get state() {
    return this._ws ? this._ws.readyState : WebSocket.CLOSED;
  }

  get _shouldBeConnected() {
    return this._ws !== null;
  }

  _onUnexpectedClose() {
    this._ledgerVersion = null;
    this.connect().then();
  }

  _onOpen() {
    const subscribeRequest = {
      command: 'subscribe',
      streams: ['ledger']
    };
    return this.request(subscribeRequest).then(() => {
      const ledgerRequest = {
        command: 'ledger',
        ledger_index: 'validated'
      };
      return this.request(ledgerRequest).then(info => {
        this._ledgerVersion = Number(info.ledger.ledger_index);
        this.emit('connected');
      });
    });
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (this.state === WebSocket.OPEN) {
        resolve();
      } else if (this.state === WebSocket.CONNECTING) {
        this._ws.once('open', resolve);
      } else {
        this._ws = new WebSocket(this._url);
        this._ws.on('message', this._onMessage.bind(this));
        this._ws.once('close', () => this._onUnexpectedClose);
        this._ws.once('open', () => this._onOpen().then(resolve, reject));
      }
    });
  }

  disconnect() {
    return new Promise((resolve) => {
      if (this.state === WebSocket.CLOSED) {
        resolve();
      } else if (this.state === WebSocket.CLOSING) {
        this._ws.once('close', resolve);
      } else {
        this._ws.removeListener('close', this._onUnexpectedClose);
        this._ws.once('close', () => {
          this._ws = null;
          this._ledgerVersion = null;
          resolve();
        });
        this._ws.close();
      }
    });
  }

  reconnect() {
    return this.disconnect().then(() => this.connect());
  }

  getLedgerVersion() {
    return new Promise((resolve, reject) => {
      const ledgerVersion = this._ledgerVersion;
      if (!this._shouldBeConnected) {
        reject(new NotConnectedError());
      } else if (this.state === WebSocket.OPEN && ledgerVersion !== null) {
        resolve(ledgerVersion);
      } else {
        this.once('connected', () => resolve(this._ledgerVersion));
      }
    });
  }

  _send(message) {
    return new Promise((resolve, reject) => {
      this._ws.send(message, undefined, (error, result) => {
        if (error) {
          reject(new DisconnectedError(error.message));
        } else {
          resolve(result);
        }
      });
    });
  }

  _sendWhenReady(message) {
    return new Promise((resolve, reject) => {
      if (this.state === WebSocket.OPEN) {
        this._send(message).then(resolve, reject);
      } else {
        this._ws.once('connected', () =>
          this._send(message).then(resolve, reject));
      }
    });
  }

  request(request, timeout) {
    return new Promise((resolve, reject) => {
      if (!this._shouldBeConnected) {
        reject(new NotConnectedError());
      }

      let timer = null;
      const self = this;
      const id = this._nextRequestID;
      this._nextRequestID += 1;
      const eventName = id.toString();

      function onDisconnect() {
        clearTimeout(timer);
        self.removeAllListeners(eventName);
        reject(new DisconnectedError());
      }

      function cleanup() {
        clearTimeout(timer);
        self.removeAllListeners(eventName);
        self._ws.removeListener('close', onDisconnect);
      }

      function _resolve(response) {
        cleanup();
        resolve(response);
      }

      function _reject(error) {
        cleanup();
        reject(error);
      }

      this.once(eventName, response => {
        if (response.status === 'error') {
          _reject(new RippledError(response.error));
        } else if (response.status === 'success') {
          _resolve(response.result);
        } else {
          _reject(new UnexpectedError(
            'unrecognized status: ' + response.status));
        }
      });

      this._ws.once('close', onDisconnect);

      // JSON.stringify automatically removes keys with value of 'undefined'
      const message = JSON.stringify(Object.assign({}, request, {id}));

      this._sendWhenReady(message).then(() => {
        const delay = timeout || this._timeout;
        timer = setTimeout(() => _reject(new TimeoutError()), delay);
      }).catch(_reject);
    });
  }
}

module.exports = Connection;