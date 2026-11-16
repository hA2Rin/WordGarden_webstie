export function createChessConnection(onTurn, onStatus) {
  const peer = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });
  let channel;
  let closed = false;

  function attach(dataChannel) {
    channel = dataChannel;
    channel.onopen = () => { if (!closed) onStatus('connected'); };
    channel.onclose = () => { if (!closed) onStatus('disconnected'); };
    channel.onmessage = ({ data }) => {
      if (closed || typeof data !== 'string' || data.length > 128) return;
      let turn;
      try { turn = JSON.parse(data); } catch { return; }
      onTurn(turn);
    };
  }

  peer.ondatachannel = ({ channel: incoming }) => {
    if (!channel && incoming.label === 'word-garden-chess') attach(incoming);
    else incoming.close();
  };
  peer.onconnectionstatechange = () => {
    if (!closed && ['failed', 'disconnected', 'closed'].includes(peer.connectionState)) {
      onStatus('disconnected');
    }
  };

  async function encodeLocal(description) {
    await peer.setLocalDescription(description);
    if (peer.iceGatheringState !== 'complete') {
      await new Promise(resolve => {
        const finish = () => {
          clearTimeout(timer);
          peer.removeEventListener('icegatheringstatechange', check);
          resolve();
        };
        const check = () => { if (peer.iceGatheringState === 'complete') finish(); };
        const timer = setTimeout(finish, 8000);
        peer.addEventListener('icegatheringstatechange', check);
        check();
      });
    }
    return btoa(JSON.stringify(peer.localDescription.toJSON()));
  }

  async function readRemote(code, type) {
    if (code.length > 100000) throw new Error('Connection code too long');
    const description = JSON.parse(atob(code.trim()));
    if (description?.type !== type || typeof description.sdp !== 'string') {
      throw new Error('Invalid connection code');
    }
    await peer.setRemoteDescription(description);
  }

  return {
    async offer() {
      attach(peer.createDataChannel('word-garden-chess'));
      return encodeLocal(await peer.createOffer());
    },
    async answer(code) {
      await readRemote(code, 'offer');
      return encodeLocal(await peer.createAnswer());
    },
    accept: code => readRemote(code, 'answer'),
    send(turn) {
      if (channel?.readyState !== 'open') return false;
      try { channel.send(JSON.stringify(turn)); return true; } catch { return false; }
    },
    close() {
      closed = true;
      peer.close();
    },
  };
}
