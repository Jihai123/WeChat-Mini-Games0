import { _decorator, Component, Node, Label, Button, director } from 'cc';
import { SceneNames } from '../enums/SceneNames';
import { WeChatService } from '../services/WeChatService';
import { STORAGE_KEYS } from '../data/GameConfig';
import { IPlayerData } from '../interfaces/IPlayerData';

const { ccclass, property } = _decorator;

/**
 * MainSceneUI — wires the main menu buttons and populates player stats.
 *
 * Node path assumptions (match ARCHITECTURE.md MainScene):
 *   Canvas/UI_Root/BtnPlay          → BtnPlay
 *   Canvas/UI_Root/HighScoreLabel   → HighScoreLabel
 *   Canvas/UI_Root/PlayerInfo/DisplayName → DisplayName label
 */
@ccclass('MainSceneUI')
export class MainSceneUI extends Component {
  @property(Button)
  btnPlay: Button | null = null;

  @property(Label)
  highScoreLabel: Label | null = null;

  @property(Label)
  displayNameLabel: Label | null = null;

  onLoad(): void {
    this._loadPlayerStats();
    this.btnPlay?.node.on(Button.EventType.CLICK, this._onPlayClicked, this);
  }

  onDestroy(): void {
    this.btnPlay?.node.off(Button.EventType.CLICK, this._onPlayClicked, this);
  }

  private _loadPlayerStats(): void {
    const pd = WeChatService.instance?.loadFromStorage<IPlayerData>(STORAGE_KEYS.PLAYER_DATA);
    const hs = WeChatService.instance?.loadFromStorage<number>(STORAGE_KEYS.HIGH_SCORE) ?? 0;

    if (this.highScoreLabel) {
      this.highScoreLabel.string = hs > 0 ? `Best: ${hs}` : 'Play your first game!';
    }
    if (this.displayNameLabel) {
      this.displayNameLabel.string = pd?.displayName ?? 'Player';
    }
  }

  private _onPlayClicked(): void {
    director.loadScene(SceneNames.GAME);
  }
}
