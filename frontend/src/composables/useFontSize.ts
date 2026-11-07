import { ref } from 'vue';

export interface FontSizeLevel {
  id: 'standard' | 'large' | 'xlarge' | 'xxlarge';
  label: string;
  /** 套用在 <html> 的 font-size 百分比；樣式用 rem，整頁跟著縮放 */
  percent: number;
}

export const FONT_SIZE_LEVELS: readonly FontSizeLevel[] = [
  { id: 'standard', label: '標準', percent: 100 },
  { id: 'large', label: '大', percent: 125 },
  { id: 'xlarge', label: '特大', percent: 150 },
  { id: 'xxlarge', label: '最大', percent: 200 }
];

export const FONT_SIZE_STORAGE_KEY = 'townpass.fontSize';

const DEFAULT_ID: FontSizeLevel['id'] = 'standard';

const isLevelId = (value: unknown): value is FontSizeLevel['id'] =>
  FONT_SIZE_LEVELS.some((level) => level.id === value);

const readStored = (): FontSizeLevel['id'] => {
  try {
    const stored = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    return isLevelId(stored) ? stored : DEFAULT_ID;
  } catch {
    // 隱私模式或被封鎖時讀不到，沿用標準字級
    return DEFAULT_ID;
  }
};

const writeStored = (id: FontSizeLevel['id']) => {
  try {
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, id);
  } catch {
    // 存不了就只在本次瀏覽有效
  }
};

const currentId = ref<FontSizeLevel['id']>(DEFAULT_ID);

const apply = (id: FontSizeLevel['id']) => {
  const level = FONT_SIZE_LEVELS.find((item) => item.id === id) ?? FONT_SIZE_LEVELS[0];
  document.documentElement.style.fontSize = `${level.percent}%`;
};

/** 啟動時呼叫一次：讀取偏好並套用到 <html>。 */
export const initFontSize = () => {
  currentId.value = readStored();
  apply(currentId.value);
};

export const useFontSize = () => {
  const setFontSize = (id: FontSizeLevel['id']) => {
    if (!isLevelId(id)) return;
    currentId.value = id;
    apply(id);
    writeStored(id);
  };

  return { levels: FONT_SIZE_LEVELS, current: currentId, setFontSize };
};
