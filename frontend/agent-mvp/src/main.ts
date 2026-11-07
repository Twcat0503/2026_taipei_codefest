import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
import './a11y.css';
import { initAccessibility } from './platform/a11y';

// Not awaited: the app must start even if the accessibility layer fails or the native side is slow.
void initAccessibility();
createApp(App).mount('#app');
