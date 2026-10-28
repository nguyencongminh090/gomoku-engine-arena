# Engine Match Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một website để hai người ở hai máy khác nhau đấu engine cờ (Freestyle / Standard / Caro, bàn m×n) trong một trận N ván, server làm trọng tài.

**Architecture:** Node.js server giữ bàn cờ chuẩn, đồng hồ và kết quả; mỗi người chơi chạy một agent CLI cục bộ, agent khởi chạy engine qua stdio và kết nối ra server bằng WebSocket. Trình duyệt chỉ xem (và tạo phòng). Trọng tài, đồng hồ, lịch ván là các module thuần (không I/O) để kiểm thử bằng đồng hồ giả.

**Tech Stack:** Node.js ≥ 20 (CommonJS, không bundler), `ws`, `better-sqlite3`, `node:test`. Web: script cổ điển (`window.TestSite`), không build, như `GomokuBoardSite`.

**Spec:** `docs/superpowers/specs/2026-10-28-engine-match-server-design.md`

## Global Constraints

- Ba luật và `INFO RULE`: Freestyle `0` (≥5 thắng), Standard `1` (đúng 5), Caro `8` = Free Caro (6+ thắng; đúng 5 thắng trừ khi cả hai ô liền kề hai đầu là quân đối thủ; cạnh bàn không phải là chặn).
- Bàn m×n, mỗi cạnh `5..22`; bàn chữ nhật dùng `RECTSTART w,h`, bàn vuông dùng `START n`. Toạ độ 0-based `x,y`.
- Đồng hồ: chạy từ lúc server gửi `go` đến lúc server nhận nước đi; độ trễ tính cho người chơi; quá `timeout_turn` hoặc hết `timeout_match` (kể cả giữa lượt) thì thua.
- Engine đang nghĩ chỉ nhận `STOP`/`YXSTOP`/`END`; mỗi lần tìm kiếm trả đúng một dòng nước đi kể cả khi bị dừng.
- Agent kết nối **ra** server (WSS ở môi trường công khai); server không tin agent: tự kiểm nước đi, tự đo giờ, giới hạn kích thước/tần suất thông điệp.
- Token ngẫu nhiên ≥ 128 bit, một token một kết nối tại một thời điểm. Phòng hết hạn sau 24 giờ không hoạt động; tối đa 5 phòng mở mỗi IP; N giây chờ nối lại mặc định 60.
- Mỗi khai cuộc đấu 2 ván đổi bên; N lẻ thì khai cuộc cuối đấu một ván. Quân khai cuộc tính vào ply và lượt đi.
- Engine "không chắc" thì từ chối; engine Gomocup cổ điển chỉ bàn vuông + Freestyle.
- Giao diện: tiếng Việt mặc định, tiếng Anh thứ hai, mọi chuỗi qua một file i18n.

## Review Focus

1. Nước đi vào ô đã có quân, ngoài bàn, sai `ply`, trùng lặp, hoặc tới sau khi ván kết thúc: bị bỏ, ván tiếp tục, không sập.
2. Bàn đầy không ai thắng: kết quả hoà. Khai cuộc đã có sẵn một hàng thắng hoặc ô ngoài bàn: bị từ chối khi tạo phòng.
3. Thông điệp JSON sai định dạng, quá lớn hoặc gửi dồn dập (kể cả từ người xem gửi `move`): bị bỏ/đóng kết nối, server không sập.
4. Cả hai agent rớt cùng lúc, hoặc một bên không bao giờ nối lại giữa các ván: trận kết thúc có kết quả xác định, không treo vĩnh viễn.
5. Danh sách khai cuộc ngắn hơn ⌈N/2⌉ hoặc trống: phòng bị từ chối kèm lý do (quyết định của kế hoạch này; trống nghĩa là phải dán ít nhất một khai cuộc, có thể là danh sách chỉ chứa "bàn trống").
6. Engine gửi nước đi muộn sau `stop` hoặc gửi thêm dòng thừa: agent nuốt đúng một dòng và không desync.

---

### Task 1: Scaffold + Board + trọng tài thắng/thua

**Files:**
- Create: `package.json`, `server/src/board.js`, `server/src/rules.js`, `server/test/rules.test.js`

**Interfaces:**
- Produces: `class Board { constructor(w, h); get(x, y): 0|1|2; set(x, y, player): void; inBounds(x, y): boolean; isFull(): boolean; fromStones(w, h, stones: {x,y,c}[]): Board (static) }`; `RULES = { freestyle: 0, standard: 1, caro: 8 }` (giá trị `INFO RULE`); `checkWin(board: Board, x: number, y: number, rule: 'freestyle'|'standard'|'caro'): boolean` — true nếu nước vừa đặt tại `(x,y)` thắng; chỉ xét bốn đường đi qua `(x,y)`.

- [ ] **Step 1:** `git init`, `npm init`, cài `ws`, `better-sqlite3`; thêm script `"test": "node --test server/test agent/test"`.
- [ ] **Step 2:** Viết test (mỗi test dựng bàn bằng `fromStones`): `freestyle: five wins`, `freestyle: six wins`, `standard: five wins`, `standard: six does not win`, `caro: six wins`, `caro: five open both ends wins`, `caro: five blocked one end wins`, `caro: five blocked both ends does not win`, `caro: five at board edge wins (edge does not block)`, `caro: five with one end edge and other end opponent wins`, `win must pass through last move` (một hàng 5 không đi qua nước vừa đặt → false), `full board without win is not a win`.
- [ ] **Step 3:** Chạy `npm test`, xác nhận thất bại; cài `Board` và `checkWin` (đếm hai phía theo từng trong 4 hướng; Standard cần tổng đúng 5; Caro xét 6+ hoặc đúng 5 với kiểm tra hai ô liền kề).
- [ ] **Step 4:** Chạy `npm test`, tất cả qua. Commit.

### Task 2: Khai cuộc và lịch ván

**Files:**
- Create: `server/src/openings.js`, `server/src/schedule.js`, `server/test/openings.test.js`, `server/test/schedule.test.js`

**Interfaces:**
- Consumes: `Board`, `checkWin` (Task 1).
- Produces: `parseOpenings(text: string, w, h, rule): number[][]`-kiểu `{x,y}[][]` — mỗi dòng là một dãy `x,y` cách nhau khoảng trắng hoặc `;`; ném `Error` với `.code` ∈ `'syntax'|'range'|'duplicate'|'winning'|'empty'`; `buildSchedule(openings, games): {gameIndex, opening: {x,y}[], firstPlayer: 'A'|'B'}[]` — khai cuộc i dùng cho ván 2i và 2i+1 với bên đi trước đổi chỗ; ném lỗi `'tooFew'` nếu `openings.length < ceil(games/2)`.

- [ ] **Step 1:** Test: `parses coords on one line`, `rejects out of range`, `rejects duplicate cell`, `rejects opening that already has a win`, `rejects empty list`, `schedule pairs swap sides`, `odd games gives last opening one game`, `too few openings throws tooFew`.
- [ ] **Step 2–4:** Chạy thấy lỗi, cài, chạy thấy qua. Commit.

### Task 3: Đồng hồ và trạng thái một ván

**Files:**
- Create: `server/src/clock.js`, `server/src/game.js`, `server/test/clock.test.js`, `server/test/game.test.js`

**Interfaces:**
- Consumes: Task 1, 2.
- Produces: `class Clock { constructor({ matchMs, turnMs, now = Date.now }); start(player): void; stop(): {elapsedMs}; remaining(player): number; expired(): null|'turn'|'match' }`. `class GameState { constructor({ w, h, rule, opening, firstPlayer, matchMs, turnMs, now }); toMove: 'A'|'B'; ply: number; stones(): {x,y,c}[]; timeLeftMs(player): number; submit(player, ply, x, y): { ok: true, result?: Result } | { ok: false, reason: 'notYourTurn'|'badPly'|'occupied'|'range'|'over' }; timeout(): Result|null; forfeit(player, reason): Result }`, `Result = { winner: 'A'|'B'|null, reason: 'five'|'full'|'timeoutTurn'|'timeoutMatch'|'disconnect'|'absent'|'illegal' }`.

- [ ] **Step 1:** Test với `now` giả: `clock charges latency to player`, `turn timeout loses`, `match budget runs out mid-turn loses`, `submit applies move and flips turn`, `submit on occupied cell is rejected and game continues`, `submit with wrong ply is rejected`, `submit after over is rejected`, `five in a row ends game with winner`, `full board is a draw`, `opening stones count in ply`.
- [ ] **Step 2–4:** Chạy thấy lỗi, cài, chạy thấy qua. Commit.

### Task 4: Giao thức thông điệp

**Files:**
- Create: `server/src/protocol.js`, `server/test/protocol.test.js`

**Interfaces:**
- Produces: `MAX_MESSAGE_BYTES = 16384`; `parseClientMessage(raw: string|Buffer, role: 'agent'|'viewer'): { ok: true, msg } | { ok: false, reason }` (agent → server: `hello{token, engine:{name,version,kind:'rapfi'|'classic'}, limits:{maxW,maxH}}`, `ready{ok, reason?}`, `move{gameId, ply, x, y}`, `info{...}`, `log{level,text}`; viewers không được gửi bất cứ thông điệp điều khiển nào); builders cho server → agent: `config{rule, w, h, matchMs, turnMs}`, `go{gameId, ply, stones, toMove, timeLeftMs, turnMs}`, `stop`, `gameOver{gameId, result}`, `ping`.

- [ ] **Step 1:** Test: `rejects non-JSON`, `rejects oversize`, `rejects unknown type`, `rejects move with non-integer coords`, `viewer move is rejected`, `hello requires token string`, `builders round-trip through parse`.
- [ ] **Step 2–4:** như trên. Commit.

### Task 5: Phòng, token, giới hạn, SQLite

**Files:**
- Create: `server/src/rooms.js`, `server/src/db.js`, `server/test/rooms.test.js`, `server/test/db.test.js`

**Interfaces:**
- Consumes: Task 2 (`parseOpenings`, `buildSchedule`).
- Produces: `class RoomRegistry { constructor({ db, now, maxPerIp = 5, ttlMs = 24*3600e3 }); create(ip, cfg): { roomId, tokenA, tokenB, viewId }` (ném lỗi mã `'ipLimit'|'badConfig'`); `authenticate(roomId, token): 'A'|'B'|null` (so sánh thời gian cố định); `delete(roomId, tokenOrCreatorSecret): boolean`; `touch(roomId)`; `sweep()` xoá phòng quá hạn }`. `cfg = { rule, w, h, games, matchMs, turnMs, reconnectSec = 60, openingsText }`. `db.js`: `openDb(path)` tạo bảng rooms, games, moves (có thời gian), `saveGame(roomId, game)`, `loadMatch(roomId)`.

- [ ] **Step 1:** Test: `token is at least 128 bits`, `authenticate rejects wrong token`, `sixth room from same ip rejected`, `room expires after 24h idle`, `creator can delete`, `bad config rejected: size out of 5..22`, `bad config rejected: too few openings`, `saved game round-trips from db`.
- [ ] **Step 2–4:** như trên. Commit.

### Task 6: Server WebSocket và điều phối trận

**Files:**
- Create: `server/src/server.js`, `server/src/match.js`, `server/test/match.test.js`, `server/test/server.test.js`

**Interfaces:**
- Consumes: Task 3–5.
- Produces: `class Match { constructor({ cfg, schedule, now, send, onEvent }); agentConnected(player, hello); agentDisconnected(player); agentMessage(player, msg); tick(): void }` — vòng đời: chờ cả hai `ready{ok:true}` → từng ván (`go`/`move`) → `gameOver` → ván kế khi cả hai kết nối → kết thúc trận (W/D/L). Cửa sổ nối lại `reconnectSec`; hết hạn → `forfeit(player,'disconnect')`; vắng mặt giữa ván quá N giây → `forfeit(player,'absent')`; cả hai vắng → trận kết thúc, người thắng là bên dẫn điểm, hoà nếu bằng. `startServer({ port, dbPath, tls? }): { close() }` — HTTP: `POST /api/rooms`, `GET /api/rooms/:id/view`, `DELETE /api/rooms/:id`, phục vụ `web/`; WS `/ws/agent` (xác thực bằng `hello.token`), `/ws/view/:viewId` (chỉ nhận). Giới hạn tần suất thông điệp (mặc định 20/giây mỗi kết nối) và `MAX_MESSAGE_BYTES`; kết nối mới cùng token thay thế kết nối cũ.

- [ ] **Step 1:** Test `Match` với agent giả và `now` giả: `starts only after both ready`, `plays all games with swapped sides`, `ready not ok rejects with reason`, `late move after gameOver is ignored`, `disconnect then reconnect within window resumes with go and current time left`, `window expiry forfeits`, `both players absent ends match`, `absent between games forfeits that game`, `odd games last opening single game`, `viewer move ignored`.
- [ ] **Step 2:** Test `server.test.js` bằng hai client `ws` giả: `agent with bad token is refused`, `second connection with same token replaces first`, `oversize message closes connection`, `flood closes connection`.
- [ ] **Step 3–5:** Chạy thấy lỗi, cài, chạy thấy qua. Commit. Ghi cách chạy TLS/reverse proxy vào `docs/` (WSS bắt buộc khi công khai).

### Task 7: Agent — tiến trình engine và adapter

**Files:**
- Create: `agent/src/engine-process.js`, `agent/src/adapters/gomocup.js`, `agent/src/adapters/rapfi.js`, `agent/src/search.js`, `agent/test/search.test.js`, `agent/test/fake-engine.js`

**Interfaces:**
- Produces: `class EngineProcess { constructor(path); start(): void; write(line: string): void; on('line', fn); stop(): Promise<void>; restart(): void }` (cwd = thư mục chứa engine, theo `extension_vncaro/server/bridge/process.py`). Adapter `{ name, capabilities: Set, start(): string[], configure({rule,w,h,matchMs,turnMs}): string[], beginSearch({stones, toMove, timeLeftMs, turnMs, w, h}): string[], parseLine(line): {type:'move',x,y}|{type:'info',data}|{type:'error',text}|null, stopCommand(): string }` (adapter Rapfi dùng `RESTART` + `YXBOARD`…`DONE` + `BEGIN`/`TURN`; Gomocup dùng `BOARD`…`DONE`). `class SearchSession { constructor(process, adapter); search(req): Promise<{x,y}>; abort(): Promise<void> }` — máy trạng thái chặt: `abort` gửi `stopCommand` rồi **chờ đúng một dòng move** trước khi nhận lệnh kế; nếu quá thời gian ân hạn thì `process.restart()`.

- [ ] **Step 1:** `fake-engine.js` là engine giả chạy bằng Node (cấu hình được: nghĩ bao lâu, có nuốt `INFO RULE` không, có trả thêm dòng thừa không). Test: `search returns the engine move`, `abort waits for the single stray move line`, `a new search after abort is not desynced by the stray move`, `abort restarts a hung engine after grace`, `extra unsolicited move line is ignored`.
- [ ] **Step 2–4:** như trên. Commit.

### Task 8: Agent — phân loại engine, kiểm tra sẵn sàng, CLI

**Files:**
- Create: `agent/src/detect.js`, `agent/src/agent.js`, `agent/bin/engine-agent.js`, `agent/test/detect.test.js`, `agent/test/agent.test.js`

**Interfaces:**
- Consumes: Task 4, 7.
- Produces: `detectEngine(process): Promise<{ kind: 'rapfi'|'classic'|'unknown', name, version, limits:{maxW,maxH} }>` (đọc `ABOUT`; nguyên tắc: không chắc thì `unknown` → bị từ chối); `checkConfig(kind, cfg): { ok: true } | { ok: false, reason }` — `classic` chỉ nhận `w===h` và `rule==='freestyle'`; `rapfi` thử `START`/`RECTSTART` + `INFO RULE` + `INFO TIMEOUT_*` và coi mọi `ERROR` là từ chối kèm lệnh gây lỗi; CLI `engine-agent --engine <path> --token <token> --server <wss-url>`. `Agent` nối WS, gửi `hello`, xử lý `config` → `ready`, `go` → `SearchSession.search` → `move`, `stop`/`gameOver` → `abort`, và tự nối lại khi rớt kết nối.

- [ ] **Step 1:** Test với `fake-engine`: `rapfi about is classified rapfi`, `unknown about is unknown`, `classic rejects rect board`, `classic rejects standard rule`, `rapfi ERROR on RULE is reported with the command`, `agent replies ready ok:false with reason`, `agent answers go with exactly one move`, `gameOver during search aborts and discards result`, `agent reconnects and answers a resent go`.
- [ ] **Step 2–4:** như trên. Commit.

### Task 9: Giao diện web

**Files:**
- Create: `web/index.html` (tạo phòng), `web/room.html` (trang phòng), `web/watch.html` (xem trực tiếp / xem lại), `web/js/i18n.js`, `web/js/board.js` (rút gọn từ `GomokuBoardSite/js/board.js`, `coords.js`), `web/js/live.js`, `web/css/style.css`, `server/test/web.test.js`

**Interfaces:**
- Consumes: HTTP/WS của Task 6.
- Produces: biểu mẫu tạo phòng (luật, m×n, N ván, thời gian, khai cuộc, số giây chờ nối lại) hiện cảnh báo "bàn chữ nhật và luật Standard/Caro cần engine kiểu Rapfi"; trang phòng hiện hai link người chơi một lần (và link xem); `watch.html` vẽ bàn bằng SVG, đồng hồ hai bên, danh sách nước, tỷ số, và xem lại ván đã lưu. Chuỗi `vi`/`en` trong `i18n.js` có cùng bộ khoá.

- [ ] **Step 1:** Test Node: `i18n has identical keys in vi and en`, `every data-i18n key in web/*.html exists`, `create form rejects size outside 5..22 client side`.
- [ ] **Step 2:** Dựng ba trang; sao chép từ `GomokuBoardSite` chỉ phần vẽ bàn (cạnh pixel-snap như CLAUDE.md của nó dặn: kích thước `#board` đặt bằng JS) và bỏ cây biến thể, tường, cổng, torus.
- [ ] **Step 3:** Chạy server, kiểm bằng Chrome headless (chụp màn hình `watch.html` với ván mẫu) và xác nhận bàn chữ nhật vẽ đúng.
- [ ] **Step 4:** Chạy `npm test`. Commit.

### Task 10: Kiểm thử đối chiếu Rapfi và đầu-cuối

**Files:**
- Create: `server/test/oracle.test.js`, `test/e2e.test.js`, `docs/knowledge/INDEX.md`, `docs/adr/0001-referee-and-agent.md`

**Interfaces:**
- Consumes: mọi task trước.
- Produces: `oracle.test.js` (bỏ qua nếu thiếu `RAPFI_ENGINE`): sinh vị thế ngẫu nhiên và các trường hợp biên (hàng 5 sát cạnh, hàng 6+, chặn một đầu/hai đầu), cho engine Rapfi đánh giá thắng theo từng `INFO RULE` (0/1/8) và so với `checkWin`; `e2e.test.js`: khởi động server thật, hai `Agent` với `fake-engine`, chơi trọn trận 4 ván trên bàn 15×12 luật Caro, kiểm kết quả trong SQLite và rằng người xem nhận mọi nước.

- [ ] **Step 1:** Viết hai test; chạy `RAPFI_ENGINE=<đường dẫn pbrain-rapfi> npm test` và xác nhận oracle qua (nếu lệch thì sửa `rules.js` theo định nghĩa engine, không sửa test).
- [ ] **Step 2:** Viết ADR ngắn (trọng tài viết mới; agent đi ra ngoài) và `docs/knowledge/INDEX.md`. Commit.

---

## Self-Review

- **Độ phủ spec:** luật (T1), khai cuộc & lịch (T2), đồng hồ (T3), giao thức (T4), phòng/bảo mật/SQLite (T5), vòng đời & mất kết nối (T6), engine/máy trạng thái STOP (T7), phân loại engine & kiểm tra sẵn sàng (T8), giao diện (T9), đối chiếu Rapfi (T10). Phần "Để người xây quyết định" (framework, định dạng thông điệp chi tiết, PGN) do người xây chọn; PGN không thuộc kế hoạch.
- **Nhất quán kiểu:** `Result`, `GameState.submit`, `Board`, `checkWin` được định nghĩa ở T1/T3 và dùng nguyên tên ở T6.
- **Quyết định của kế hoạch (không có trong spec):** CommonJS + `node:test`; danh sách khai cuộc phải có ít nhất ⌈N/2⌉ mục; tần suất 20 thông điệp/giây mỗi kết nối.
