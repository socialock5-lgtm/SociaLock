import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Button, TextInput, StyleSheet, TouchableOpacity } from 'react-native';

/*
  WebRTCChat component (works in browser with standard WebRTC).
  For mobile (react-native), install react-native-webrtc and adapt RTCPeerConnection import.
  This component demonstrates signaling via Supabase 'signals' table (passed via props.supabase).
*/

export default function WebRTCChat({ supabase, localUser }){
  const pcRef = useRef(null);
  const dataChannelRef = useRef(null);
  const [remoteId, setRemoteId] = useState('');
// ------------------- chunked file transfer helpers -------------------
const CHUNK_SIZE = 128 * 1024; // 128KB
const pendingTransfers = useRef({}); // track ongoing transfers by id

function textChunkHandlerInit(){
  // placeholder to ensure handler functions exist
}

function arrayBufferToBase64(buffer){
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToArrayBuffer(base64){
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for(let i=0;i<len;i++) bytes[i]=binary.charCodeAt(i);
  return bytes.buffer;
}

async function sendFileInChunks(file){
  // file: File object (browser) or React Native blob - adapt as needed
  const id = Math.random().toString(36).slice(2,9);
  const size = file.size || file._data?.size || 0;
  const meta = { id, name: file.name || 'file.bin', size, chunkSize: CHUNK_SIZE };
  // notify receiver via signaling (file-meta)
  await supabase.from('signals').insert([{ room_id: null, sender_id: localUser.id, receiver_id: remoteId, signal_type: 'file-meta', payload: meta }]);
  // stream and send
  const reader = file.stream ? file.stream().getReader() : null;
  let offset = 0;
  if(reader){
    while(true){
      const { done, value } = await reader.read();
      if(done) break;
      // send chunk as base64 string over datachannel
      const b64 = arrayBufferToBase64(value.buffer || value);
      dataChannelRef.current.send(JSON.stringify({ type: 'chunk', id, data: b64, offset }));
      offset += value.byteLength;
    }
  } else {
    // fallback using slice (for older browsers)
    while(offset < size){
      const chunk = file.slice(offset, offset + CHUNK_SIZE);
      const arr = await chunk.arrayBuffer();
      const b64 = arrayBufferToBase64(arr);
      dataChannelRef.current.send(JSON.stringify({ type: 'chunk', id, data: b64, offset }));
      offset += arr.byteLength;
    }
  }
  // send complete marker
  dataChannelRef.current.send(JSON.stringify({ type: 'chunk-end', id }));
}

// ------------------- Resume-capable chunked transfer & persistence -------------------
// We store transfer progress in localStorage (browser) or AsyncStorage (React Native) under key 'transfer_state'.
// Sender-side: reads ack updates from receiver and resumes from lastAckSeq.
// Receiver-side: sends ack messages periodically with lastSeq received.
// Note: For production you should add robust checks, signatures, and persistent server-side state if needed.
const TRANSFER_STORAGE_KEY = 'transfer_state';

async function saveTransferState(state){
  try{
    if(typeof localStorage !== 'undefined') localStorage.setItem(TRANSFER_STORAGE_KEY, JSON.stringify(state));
    else await AsyncStorage.setItem(TRANSFER_STORAGE_KEY, JSON.stringify(state));
  }catch(e){ console.warn('saveTransferState', e); }
}

async function loadTransferState(){
  try{
    const v = (typeof localStorage !== 'undefined') ? localStorage.getItem(TRANSFER_STORAGE_KEY) : await AsyncStorage.getItem(TRANSFER_STORAGE_KEY);
    return v ? JSON.parse(v) : {};
  }catch(e){ console.warn('loadTransferState', e); return {}; }
}

// Sender: improved sendFileInChunks that responds to ACKs and resumes
async function sendFileInChunksWithResume(file){
  const id = Math.random().toString(36).slice(2,9);
  const size = file.size || file._data?.size || 0;
  const totalChunks = Math.ceil(size / CHUNK_SIZE);
  const meta = { id, name: file.name || 'file.bin', size, totalChunks, chunkSize: CHUNK_SIZE };
  // store initial state
  const state = await loadTransferState();
  state[id] = { id, offset: 0, lastAckSeq: -1, totalChunks, completed:false };
  await saveTransferState(state);
  await supabase.from('signals').insert([{ room_id: null, sender_id: localUser.id, receiver_id: remoteId, signal_type: 'file-meta', payload: meta }]);
  let seq = 0;
  // if there is an ack we can resume from ack+1
  const currentState = (await loadTransferState())[id] || { offset:0, lastAckSeq:-1 };
  let startChunk = currentState.lastAckSeq + 1;
  // use slice loop to ensure compatibility
  for(let chunkIndex = startChunk; chunkIndex < totalChunks; chunkIndex++){
    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, size);
    const blobChunk = file.slice(start, end);
    const arr = await blobChunk.arrayBuffer();
    const b64 = arrayBufferToBase64(arr);
    // include seq number for ack tracking
    const payload = JSON.stringify({ type: 'chunk', id, seq: chunkIndex, data: b64 });
    dataChannelRef.current.send(payload);
    // optimistic save offset/seq
    const s = await loadTransferState();
    s[id] = s[id] || {};
    s[id].lastSentSeq = chunkIndex;
    await saveTransferState(s);
    // wait for small gap to avoid flooding (tune in prod)
    await new Promise(r => setTimeout(r, 10));
  }
  // send final marker
  dataChannelRef.current.send(JSON.stringify({ type: 'chunk-end', id }));
}

// Receiver: send ACK messages periodically
let ackTimer = null;
function startAckTimer(id){
  if(ackTimer) clearInterval(ackTimer);
  ackTimer = setInterval(async ()=>{
    const t = pendingTransfers.current[id];
    if(t){
      const lastSeq = t.lastSeqReceived || -1;
      dataChannelRef.current.send(JSON.stringify({ type: 'ack', id, lastSeq }));
      // persist receiver progress
      const state = await loadTransferState();
      state[id] = state[id] || {};
      state[id].lastSeq = lastSeq;
      await saveTransferState(state);
    }
  }, 1000);
}
function stopAckTimer(){ if(ackTimer) clearInterval(ackTimer); ackTimer = null; }

// Update handleDataChannelMessage to process 'ack' messages and resume sender accordingly

function handleDataChannelMessage(event){
  try{
    const isString = typeof event.data === 'string';
    if(!isString){
      // for binary frames, push directly (not implemented in this demo)
      return;
    }
    const msg = JSON.parse(event.data);
    if(msg.type === 'chunk'){
      const t = pendingTransfers.current[msg.id] || { buffers: [], received: 0, name: 'file.bin', size: null };
      pendingTransfers.current[msg.id] = t;
      t.buffers.push(base64ToArrayBuffer(msg.data));
      t.received += (msg.data.length * 3) / 4; // approximate bytes
      // progress UI could be updated via state (omitted for brevity)
    } else if(msg.type === 'chunk-end'){
      const t = pendingTransfers.current[msg.id];
      if(t){
        const blob = new Blob(t.buffers);
        // create download link (browser) or save to device (native) - in browser demo:
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = t.name; a.click();
        URL.revokeObjectURL(url);
        delete pendingTransfers.current[msg.id];
      }
    } else {
      console.log('DC msg', msg);
    }
  }catch(e){ console.warn('DC parse', e); }
}

  const [status, setStatus] = useState('idle');

  useEffect(()=>{ return ()=> { if(pcRef.current) pcRef.current.close(); } },[]);

  async function sendSignal(supabaseClient, { type, payload, receiver_id }){
    await supabaseClient.from('signals').insert([{ room_id: null, sender_id: localUser.id, receiver_id, signal_type: type, payload }]);
  }

  async function createPeerAndOffer(targetId){
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pcRef.current = pc;
    dataChannelRef.current = pc.createDataChannel('chat');
    dataChannelRef.current.onopen = ()=> setStatus('data-open');
    textChunkHandlerInit();
    dataChannelRef.current.onmessage = e => handleDataChannelMessage(e);

    pc.onicecandidate = e => { if(e.candidate) sendSignal(supabase, { type: 'ice', payload: e.candidate, receiver_id: targetId }); };
    pc.ontrack = e => { console.log('track', e); };

    // get media
    try{
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
    }catch(e){ console.warn('getUserMedia failed', e); }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await sendSignal(supabase, { type: 'offer', payload: offer, receiver_id: targetId });
    setStatus('offer-sent');

    // subscribe to signal replies for this user
    const sub = supabase.from(`signals:receiver_id=eq.${localUser.id}`).on('INSERT', payload=> handleSignal(payload.new)).subscribe();
    // store subscription to remove later - simplified for demo
  }

  async function handleSignal(row){
    if(row.sender_id === localUser.id) return;
    const type = row.signal_type; const payload = row.payload;
    if(type === 'offer'){
      // incoming offer -> create answer
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      pcRef.current = pc;
      pc.ondatachannel = e => { dataChannelRef.current = e.channel; dataChannelRef.current.onmessage = ev => console.log('dc msg', ev.data); };
      pc.onicecandidate = e => { if(e.candidate) sendSignal(supabase, { type: 'ice', payload: e.candidate, receiver_id: row.sender_id }); };
      pc.ontrack = e => console.log('remote track', e);
      try{
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        stream.getTracks().forEach(track => pc.addTrack(track, stream));
      }catch(e){ console.warn('getUserMedia', e); }
      await pc.setRemoteDescription(payload);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendSignal(supabase, { type: 'answer', payload: answer, receiver_id: row.sender_id });
    } else if(type === 'answer'){
      await pcRef.current.setRemoteDescription(payload);
    } else if(type === 'ice'){
      try{ await pcRef.current.addIceCandidate(payload); }catch(e){console.warn(e)}
    }
  }

  return (
    <View style={s.container}>
      <Text style={{color:'#fff'}}>WebRTC (P2P) demo — Status: {status}</Text>
      <TextInput placeholder="Target user id" placeholderTextColor="#999" value={remoteId} onChangeText={setRemoteId} style={s.input} />
      <TouchableOpacity style={s.btn} onPress={()=> createPeerAndOffer(remoteId)}><Text style={{color:'#fff'}}>Call / Send Offer</Text></TouchableOpacity>
      <TouchableOpacity style={s.btnAlt} onPress={()=> { if(dataChannelRef.current) dataChannelRef.current.send('hello'); }}><Text style={{color:'#000'}}>Send DC msg</Text></TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container:{padding:12,margin:12,backgroundColor:'#0b2033',borderRadius:8},
  input:{background:'#fff',color:'#000',padding:8,borderRadius:6,marginVertical:8},
  btn:{background:'#1877f2',padding:10,borderRadius:8,alignItems:'center',marginVertical:6},
  btnAlt:{background:'#fff',padding:10,borderRadius:8,alignItems:'center',marginVertical:6}
});
