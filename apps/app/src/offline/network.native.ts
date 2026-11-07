import NetInfo from '@react-native-community/netinfo';

/** Conectividade - versão nativa (NetInfo). */
let last = true;

export function deviceOnline(): boolean {
  return last;
}

export function onConnectivityChange(fn: (online: boolean) => void): () => void {
  return NetInfo.addEventListener((s) => {
    const online = s.isConnected !== false && s.isInternetReachable !== false;
    if (online !== last) {
      last = online;
      fn(online);
    }
  });
}
