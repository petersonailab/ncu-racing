# 中大賽車 NCU Racing

在國立中央大學校園裡比賽的網頁版 3D 賽車遊戲。賽道依照手繪路線，起點與終點都在聽松台，一圈約 2.77 km。

**線上玩：** https://petersonailab.github.io/ncu-racing/

## 玩法

| 模式 | 說明 |
|---|---|
| 計時賽 | 單人跑圈，最快單圈會記錄在瀏覽器裡 |
| AI 對戰 | 1–7 台電腦車，會超車、會被擠出賽道後回來 |
| 多人連線 | 最多 8 人，輸入**同一個房號**就會進到同一個房間 |

多人連線步驟：

1. 進入「多人連線」，輸入房號（英文或數字，例如 `NCU1`），按「進入房間」。
2. 朋友輸入同一個房號，或直接打開你傳的邀請連結（`…/?room=NCU1`）。
3. 第一個進房的人是房主。人到齊後，由房主按「開始比賽」。

操作：`W/↑` 油門、`S/↓` 煞車／倒車、`A D/← →` 轉向、`空白鍵` 手煞車、`C` 切換視角、`R` 回賽道、
`G` 導引線、`T` 循跡／車身穩定控制、`L` 建築名稱、`M` 靜音、`Esc` 暫停。也支援遊戲手把。

### 導引線

賽道上的箭頭會沿著最佳行車線（外－內－外）排列，並依照你**現在的速度**即時變色：

| 顏色 | 意思 |
|---|---|
| 綠 | 這個速度可以全油門通過 |
| 黃 | 稍微太快，鬆油門或輕踩煞車 |
| 紅 | 太快了，要確實煞車 |

### 駕駛輔助（`T` 開關，預設開啟）

- **循跡控制**：保留後輪抓地力餘裕，後輪開始打滑時自動收油。
- **車身穩定控制**：車尾滑出時自動修正，避免打轉。
- **手煞車**：按住時輔助會暫時關閉，所以還是可以甩尾。

關掉輔助後，P1 的 900 匹馬力很容易一腳油門就甩尾，適合想挑戰的人。

### 多人連線怎麼運作

遊戲沒有自己的伺服器，玩家之間用 WebRTC 直接點對點連線（[PeerJS](https://peerjs.com/)）。

- 房主的瀏覽器負責轉發所有人的資料。**房主離開，房間就會關閉。**
- 配對時用的是 PeerJS 的免費公用伺服器。
- 在少數比較嚴格的網路（部分公司、宿舍網路）可能連不上。遇到這種情況，可以換個網路或改用手機熱點。

## 在自己電腦上執行

```bash
python3 tools/serve.py
```

接著打開 http://localhost:8000 。這個開發用伺服器會關閉快取，改完程式重新整理就能看到。
three.js 和 PeerJS 會從 jsDelivr CDN 載入，所以需要網路。

推送到 `main` 分支後，GitHub Actions 會自動把 `public/` 部署到 GitHub Pages。

## 專案結構

```
public/                    網站本體（部署到 GitHub Pages 的就是這個資料夾）
  index.html               介面（選單、房間、HUD）
  data/campus.json         道路、435 棟建築、水域、球場、約 2,300 棵樹
  data/track.json          賽道中心線
  assets/mclaren_p1.glb    車輛模型
  js/main.js               遊戲流程、相機、HUD
  js/net.js                點對點多人連線（房主轉發）與遠端車輛插值
  js/vehicle.js            車輛物理（自行車模型、Pacejka 輪胎、重量轉移、煞車摩擦圓、7 速自排、TC/ESC）
  js/ai.js                 AI 車手（沿最佳行車線的 pure pursuit 轉向 + 速度剖面）
  js/guide.js              導引線（依速度變色的箭頭）
  js/track.js              賽道、最佳行車線（最小曲率）與安全速度剖面
  js/world.js              用地圖資料建出 3D 場景、碰撞、路面判定
  js/trees.js              葉片貼圖樹木
  js/carModel.js           載入車輛、轉正方向、綁定輪子
  js/textures.js           程式產生的柏油、磚道、建築立面等材質
  js/audio.js              合成引擎聲、胎噪、碰撞聲
tools/build_map.py         把 OpenStreetMap 資料轉成遊戲地圖與賽道
tools/serve.py             本機開發用伺服器（不快取）
data/osm_raw.json          從 Overpass API 下載的 OSM 原始資料
.github/workflows/pages.yml  自動部署到 GitHub Pages
```

## 修改賽道

賽道路點寫在 `tools/build_map.py` 的 `WAYPOINTS`。座標單位是公尺，x 往東、y 往北，原點在校園中央附近。
改完後執行：

```bash
python3 tools/build_map.py
```

腳本會自動把路點吸附到最近的道路、把彎道修成圓弧，並讓賽道離建築牆面至少 6.6 m。

## 授權與來源

- 車輛模型：[McLaren P1](https://sketchfab.com/3d-models/mclaren-p1-wwwvecarzcom-adae2edc721e4ce7b31c1d06a581e30a) by vecarz，CC BY 4.0
- 地圖資料 © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors，ODbL（`data/` 與 `public/data/` 由 OSM 衍生，沿用 ODbL）
- 材質、樹木、音效都是程式即時產生，沒有使用第三方圖片
