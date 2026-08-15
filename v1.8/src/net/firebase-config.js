// Firebase web config. This is NOT a secret - it is a public identifier that
// ships inside every page using Firebase. Security comes from the rules in
// database.rules.json, not from hiding this.
//
// Ducks shares the gzowos-games project with SatisFarm and MJJ Archives because
// the Google Cloud project quota on this account is exhausted. All Ducks data
// lives under the `ducks/` branch and the rules keep it isolated.

export const firebaseConfig = {
  apiKey: 'AIzaSyAaTuELH_mToxH3hRJ4WPIVTECSH7Z8-FY',
  authDomain: 'gzowos-games.firebaseapp.com',
  databaseURL: 'https://gzowos-games-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'gzowos-games',
  storageBucket: 'gzowos-games.firebasestorage.app',
  messagingSenderId: '658227201482',
  appId: '1:658227201482:web:627b44e3c4c2988bc4bb33',
};
