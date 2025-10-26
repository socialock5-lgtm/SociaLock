import React, { useEffect, useState } from 'react';
import { SafeAreaView, View, Text, Button, FlatList, TextInput, StyleSheet } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import WebRTCChat from './components/WebRTCChat';
import { generateKeypair, keypairToStorage, keypairToStorage as kts } from './utils/crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://YOUR_SUPABASE_URL';
const SUPABASE_ANON = process.env.SUPABASE_ANON || 'YOUR_SUPABASE_ANON_KEY';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

export default function App(){
  const [user, setUser] = useState(null);
  const [posts, setPosts] = useState([]);
  const [content, setContent] = useState('');

  useEffect(()=>{
    supabase.auth.getSession().then(({ data }) => {
      if(data?.session) setUser(data.session.user);
    });
    fetchPosts();
    const sub = supabase.from('posts').on('INSERT', payload=> setPosts(p=>[payload.new,...p])).subscribe();
    return ()=> supabase.removeSubscription(sub);
  },[]);

  async function signInWithGoogle(){ await supabase.auth.signInWithOAuth({ provider: 'google' }); }

// After OAuth redirect completes, call Edge Function to log login event (client-side)
async function logLoginToAnalytics(user){
  try{
    // call Supabase Edge Function 'log_login' (must be deployed to your Supabase project)
    const res = await fetch((process.env.SUPABASE_URL || '').replace('/','') + '/functions/v1/log_login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.id, language: user.user_metadata?.language || 'en' })
    });
    // Note: Alternatively use supabase.functions.invoke('log_login', { body: { ... } }) if configured
  }catch(e){ console.warn('logLoginToAnalytics error', e); }
}

// monitor auth state and call logLoginToAnalytics when session found
supabase.auth.onAuthStateChange((event, session) => {
  if(session?.user){
    logLoginToAnalytics(session.user);
  }
});


  async function fetchPosts(){ const { data } = await supabase.from('posts').select('*').order('created_at',{ascending:false}).limit(50); setPosts(data||[]); }

  async function createPost(){ if(!content.trim()) return; if(content.length>100){ alert('Max 100 chars'); return; } const { error } = await supabase.from('posts').insert([{ author_id: user?.id, content: content.trim() }]); if(error) alert(error.message); else setContent(''); }

  if(!user) return (<SafeAreaView style={styles.container}><Text style={styles.title}>SociaLock</Text><Button title="Sign in with Google" onPress={signInWithGoogle} /></SafeAreaView>);

  // ensure user crypto keys exist (simple demo: store in AsyncStorage)
  useEffect(()=>{ (async ()=>{ const k = await AsyncStorage.getItem('keypair'); if(!k){ const kp = generateKeypair(); await AsyncStorage.setItem('keypair', JSON.stringify(keypairToStorage(kp))); } })(); },[]);


  return (
    <SafeAreaView style={styles.container}>
      <View style={{padding:12}}>
        <Text style={{color:'#fff'}}>Welcome, {user.email}</Text>
        <TextInput placeholder="What's on your mind?" placeholderTextColor="#999" value={content} onChangeText={setContent} style={styles.input} />
        <Button title="Post" onPress={createPost} />
      </View>
      <FlatList data={posts} keyExtractor={item=>item.id} renderItem={({item})=> (<View style={styles.post}><Text style={{color:'#000'}}>{item.content}</Text><Text style={{fontSize:10}}>{item.created_at}</Text></View>)} />
      <WebRTCChat supabase={supabase} localUser={user} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:{flex:1,backgroundColor:'#071029'},
  title:{fontSize:28,color:'#fff',textAlign:'center',margin:20},
  input:{background:'#fff',color:'#000',padding:8,borderRadius:8,marginBottom:8},
  post:{background:'#fff',margin:8,padding:10,borderRadius:8}
});
