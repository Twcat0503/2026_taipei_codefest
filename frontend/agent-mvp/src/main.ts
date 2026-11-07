import { createApp } from 'vue';
import App from './App.vue';
import { mountDevHud } from './dev/hud';
import './style.css';

createApp(App).mount('#app');
mountDevHud();
