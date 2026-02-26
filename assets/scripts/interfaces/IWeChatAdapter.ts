export interface IUserInfoResult {
  nickName: string;
  avatarUrl: string;
  gender: number;
  city: string;
  province: string;
  country: string;
}

export interface IShareOptions {
  title: string;
  imageUrl?: string;
  query?: string;
}

export interface IWeChatAdapter {
  getUserInfo(): Promise<IUserInfoResult>;
  shareAppMessage(options: IShareOptions): void;
  showInterstitialAd(adUnitId: string): Promise<void>;
  createBannerAd(adUnitId: string, style: object): void;
  destroyBannerAd(): void;
  saveToStorage(key: string, data: unknown): void;
  loadFromStorage<T>(key: string): T | null;
  removeFromStorage(key: string): void;
  vibrateShort(): void;
  vibrateLong(): void;
  reportEvent(eventId: string, data: Record<string, string | number>): void;
  getSystemInfo(): Promise<Record<string, unknown>>;
}
