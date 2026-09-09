// ==UserScript==
// @name         BeatBattleX
// @namespace    beatbattlex
// @version      1.0.1
// @match        https://beat-battle.net/*
// @match        https://*.beat-battle.net/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @homepageURL  https://github.com/FaithfullyOSS/BeatBattleX
// @supportURL   https://github.com/FaithfullyOSS/BeatBattleX/issues
// @updateURL    https://raw.githubusercontent.com/FaithfullyOSS/BeatBattleX/main/beatbattlex.user.js
// @downloadURL  https://raw.githubusercontent.com/FaithfullyOSS/BeatBattleX/main/beatbattlex.user.js
// @connect      discord.com
// @connect      discordapp.com
// ==/UserScript==

(function () {
  'use strict';

  const STATE = {
    roomId: null,
    entries: [],
    room: null,
    memberById: {},
    kickHistory: [],
    kickHistoryRoomId: null,
    chatMessages: [],
    chatRoomId: null,
    leftMembers: [],
    leftMembersRoomId: null,
    joinedMembers: [],
    joinedMembersRoomId: null,
    webhookUrl: '',
    notifiedUploads: [],
    notifiedUploadsRoomId: null,
    notifiedUploadsNeedsSeed: false,
    notifiedChatIds: [],
    notifiedChatRoomId: null,
    notifiedChatNeedsSeed: false,
    webhookToggles: { uploads: true, joins: true, left: true, chat: true, kicks: true, votes: true, results: true, nowPlaying: true },
    resultsShown: false,
    resultsShownRoomId: null,
    notifiedNowPlaying: { revision: null, userId: null },
    ratingVotes: {},
    ratingVotesRoomId: null,
    ratingVotesNeedsSeed: false,
    toastToggles: { votes: true, kicks: true, uploads: true, joins: false, left: false, results: true },
    hud: { hidden: false, collapsed: false, x: null, y: null },
    ui: { tab: 'uploads', open: false, muted: false, sort: 'time', sound: false },
    lastMsgAt: 0,
  };

  const DISCORD_INVITE = 'https://discord.gg/XrtrRWauDw';

  const LS_KICK_PREFIX = 'bb-kick-history-';
  const LS_CHAT_PREFIX = 'bb-chat-history-';
  const LS_LEFT_PREFIX = 'bb-left-members-';
  const LS_JOINED_PREFIX = 'bb-joined-members-';
  const LS_NOTIFIED_PREFIX = 'bb-notified-uploads-';
  const LS_NOTIFIED_CHAT_PREFIX = 'bb-notified-chat-';
  const LS_WEBHOOK_KEY = 'bb-webhook-url';
  const LS_WEBHOOK_TOGGLES_KEY = 'bb-webhook-toggles';
  const LS_RESULTS_PREFIX = 'bb-results-shown-';
  const LS_RATING_VOTES_PREFIX = 'bb-rating-votes-';
  const LS_TOAST_TOGGLES_KEY = 'bb-toast-toggles';
  const LS_HUD_KEY = 'bb-hud-prefs';
  const LS_UI_KEY = 'bb-ui-prefs';

  function getUrlSetting(key) {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(key, '') || '';
    } catch (e) {}
    try {
      return localStorage.getItem(key) || '';
    } catch (e) {
      return '';
    }
  }

  function setUrlSetting(key, url) {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, url);
        return;
      }
    } catch (e) {}
    try {
      localStorage.setItem(key, url);
    } catch (e) {}
  }

  function getWebhookUrl() {
    return getUrlSetting(LS_WEBHOOK_KEY);
  }

  function setWebhookUrl(url) {
    setUrlSetting(LS_WEBHOOK_KEY, url);
  }

  function getJsonSetting(key) {
    let raw = null;
    try {
      if (typeof GM_getValue === 'function') raw = GM_getValue(key, null);
    } catch (e) {}
    if (raw == null) {
      try {
        raw = localStorage.getItem(key);
      } catch (e) {}
    }
    if (!raw) return null;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      return null;
    }
  }

  function setJsonSetting(key, value) {
    const raw = JSON.stringify(value);
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, raw);
        return;
      }
    } catch (e) {}
    try {
      localStorage.setItem(key, raw);
    } catch (e) {}
  }

  function getWebhookToggles() {
    return getJsonSetting(LS_WEBHOOK_TOGGLES_KEY);
  }

  function setWebhookToggles(toggles) {
    setJsonSetting(LS_WEBHOOK_TOGGLES_KEY, toggles);
  }

  function setToastToggles(toggles) {
    setJsonSetting(LS_TOAST_TOGGLES_KEY, toggles);
  }

  function saveHudPrefs() {
    setJsonSetting(LS_HUD_KEY, STATE.hud);
  }

  STATE.webhookUrl = getWebhookUrl();
  Object.assign(STATE.webhookToggles, getWebhookToggles() || {});
  Object.assign(STATE.toastToggles, getJsonSetting(LS_TOAST_TOGGLES_KEY) || {});
  Object.assign(STATE.hud, getJsonSetting(LS_HUD_KEY) || {});
  Object.assign(STATE.ui, getJsonSetting(LS_UI_KEY) || {});

  function loadFromLS(prefix, roomId) {
    try {
      return JSON.parse(localStorage.getItem(prefix + roomId)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveToLS(prefix, roomId, data) {
    try {
      localStorage.setItem(prefix + roomId, JSON.stringify(data));
    } catch (e) {
    }
  }

  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const NativeWebSocket = pageWindow.WebSocket;

  function patchSocket(ws, url) {
    if (!/\/api\/ws\/rooms/.test(url)) return;
    if (ws.__bbHooked) return;
    ws.__bbHooked = true;
    ws.addEventListener('message', (ev) => {
      STATE.lastMsgAt = Date.now();
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      if (msg && msg.type === 'room.joined' && msg.room) {
        handleRoomUpdate(msg.room);
        sendWebhookRoomJoined(msg.room);
      } else if (msg && (msg.type === 'room.updated' || msg.type === 'user.active_game') && msg.room) {
        handleRoomUpdate(msg.room);
      } else if (msg && msg.type === 'room.chat.history' && Array.isArray(msg.messages)) {
        handleChatMessages(msg.roomId || STATE.roomId, msg.messages);
      } else if (msg && typeof msg.type === 'string' && msg.type.indexOf('chat') !== -1) {
        const list = Array.isArray(msg.messages) ? msg.messages : (msg.message ? [msg.message] : null);
        if (list) handleChatMessages(msg.roomId || STATE.roomId, list);
      }
    });

    ws.addEventListener('close', () => {
      console.log('[BB overlay] room socket closed; next reconnect is hooked automatically');
    });
  }

  function WrappedWebSocket(url, protocols) {
    const ws = protocols === undefined
      ? new NativeWebSocket(url)
      : new NativeWebSocket(url, protocols);
    try {
      patchSocket(ws, String(url));
    } catch (e) {
      console.error('[BB overlay] hook error', e);
    }
    return ws;
  }
  WrappedWebSocket.prototype = NativeWebSocket.prototype;
  WrappedWebSocket.CONNECTING = NativeWebSocket.CONNECTING;
  WrappedWebSocket.OPEN = NativeWebSocket.OPEN;
  WrappedWebSocket.CLOSING = NativeWebSocket.CLOSING;
  WrappedWebSocket.CLOSED = NativeWebSocket.CLOSED;
  pageWindow.WebSocket = WrappedWebSocket;

  function handleRoomUpdate(room) {
    const sameRoom = STATE.roomId === room.id;

    if (STATE.leftMembersRoomId !== room.id) {
      STATE.leftMembers = loadFromLS(LS_LEFT_PREFIX, room.id);
      STATE.leftMembersRoomId = room.id;
    }
    if (STATE.joinedMembersRoomId !== room.id) {
      STATE.joinedMembers = loadFromLS(LS_JOINED_PREFIX, room.id);
      STATE.joinedMembersRoomId = room.id;
    }
    if (sameRoom) {
      detectLeftMembers(room);
      detectJoinedMembers(room);
    }

    if (STATE.resultsShownRoomId !== room.id) {
      let raw = null;
      try {
        raw = localStorage.getItem(LS_RESULTS_PREFIX + room.id);
      } catch (e) {}
      STATE.resultsShown = raw === '1';
      STATE.resultsShownRoomId = room.id;
    }

    if (STATE.notifiedUploadsRoomId !== room.id) {
      let raw = null;
      try {
        raw = localStorage.getItem(LS_NOTIFIED_PREFIX + room.id);
      } catch (e) {}
      STATE.notifiedUploadsNeedsSeed = raw === null;
      STATE.notifiedUploads = loadFromLS(LS_NOTIFIED_PREFIX, room.id);
      STATE.notifiedUploadsRoomId = room.id;
    }

    if (STATE.roomId && !sameRoom) {
      STATE.entries = [];
      STATE.memberById = {};
      if (STATE.chatRoomId !== room.id) {
        STATE.chatMessages = loadFromLS(LS_CHAT_PREFIX, room.id);
        STATE.chatRoomId = room.id;
        renderChat();
      }
    }
    STATE.roomId = room.id;

    const uploaded = room.uploadedBeatsByUserId || {};
    const prevUploadedCount = STATE.entries.filter((e) => e.hasUploaded).length;
    const memberById = {};
    (room.members || []).forEach((m) => {
      memberById[m.userId] = m;
    });
    STATE.memberById = memberById;
    STATE.room = room;

    processKickVote(room);

    const scores = computeScores(room);
    const forfeitedIds = new Set(room.forfeitedUserIds || []);
    const anyVotes = Object.keys(room.votesByUserId || {}).length > 0;
    const votingActive = anyVotes || ['voting', 'showcase', 'results'].indexOf(room.gameState) !== -1;
    const expectedVotes = votingActive ? Math.max(0, (room.members || []).length - 1) : 0;

    const allIds = Array.from(new Set([...Object.keys(memberById), ...Object.keys(uploaded)]));

    const entries = allIds.map((userId) => {
      const beat = uploaded[userId] || null;
      const member = memberById[userId] || null;
      const scoreEntry = scores[userId];
      return {
        userId,
        displayName: (beat && beat.displayName) || (member && member.displayName) || userId,
        name: (member && member.name) || '',
        nameColorKey: member && member.nameColorKey,
        hasUploaded: !!beat,
        left: !member,
        forfeited: forfeitedIds.has(userId),
        fileName: beat ? beat.fileName : null,
        mimeType: beat ? beat.mimeType : null,
        byteSize: beat ? beat.byteSize : null,
        durationSeconds: beat ? beat.durationSeconds : null,
        downloadable: beat ? beat.downloadable : null,
        playbackUrl: beat ? beat.playbackUrl : null,
        uploadedAt: beat ? beat.uploadedAt : null,
        sha256: beat ? beat.sha256 : null,
        score: scoreEntry ? scoreEntry.sum : (expectedVotes && beat ? 0 : null),
        voteCount: scoreEntry ? scoreEntry.count : 0,
        expectedVotes,
        dupeWith: [],
      };
    });

    const bySha = {};
    entries.forEach((e) => {
      if (!e.sha256) return;
      (bySha[e.sha256] = bySha[e.sha256] || []).push(e);
    });
    entries.forEach((e) => {
      const group = e.sha256 && bySha[e.sha256];
      e.dupeWith = group && group.length > 1
        ? group.filter((o) => o.userId !== e.userId).map((o) => o.displayName)
        : [];
    });

    entries.sort((a, b) => {
      if (a.uploadedAt && b.uploadedAt) return new Date(a.uploadedAt) - new Date(b.uploadedAt);
      if (a.uploadedAt) return -1;
      if (b.uploadedAt) return 1;
      return a.displayName.localeCompare(b.displayName);
    });
    STATE.entries = entries;
    notifyNewUploads(room, entries);
    detectRatingVotes(room);
    checkResults(room, entries);
    const uploadedCount = entries.filter((e) => e.hasUploaded).length;
    renderPanel(uploadedCount > prevUploadedCount);
  }

  function checkResults(room, entries) {
    const finished = room.gameState === 'results' || room.results != null;
    if (!finished || STATE.resultsShown) return;
    STATE.resultsShown = true;
    try {
      localStorage.setItem(LS_RESULTS_PREFIX + room.id, '1');
    } catch (e) {}
    const ranked = entries
      .filter((e) => e.hasUploaded)
      .slice()
      .sort((a, b) => (b.score || 0) - (a.score || 0));
    const winner = ranked[0];
    if (winner) {
      playCue(880, 220);
      toast('results', `winner: ${winner.displayName}`, `${formatAvgRating(winner.score, winner.expectedVotes) || '?'}/5 from ${winner.voteCount} vote${winner.voteCount === 1 ? '' : 's'}`, {
        tone: 'good',
        avatarUrl: avatarForUser(winner.userId),
        ttl: 12000,
      });
    }
    sendWebhookResults(room, ranked);
  }

  function detectLeftMembers(room) {
    const prevMemberById = STATE.memberById || {};
    const prevIds = Object.keys(prevMemberById);
    if (!prevIds.length) return;
    const currentIds = new Set((room.members || []).map((m) => m.userId));
    const alreadyLeftIds = new Set(STATE.leftMembers.map((l) => l.userId));
    let changed = false;

    prevIds.forEach((userId) => {
      if (currentIds.has(userId) || alreadyLeftIds.has(userId)) return;
      const m = prevMemberById[userId];
      const prevEntry = STATE.entries.find((e) => e.userId === userId);
      const leftEntry = {
        userId,
        name: m.name,
        displayName: m.displayName,
        avatarUrl: m.avatarUrl,
        nameColorKey: m.nameColorKey,
        leftAt: new Date().toISOString(),
        kicked: (room.kickedUserIds || []).includes(userId),
        upload: prevEntry && prevEntry.hasUploaded
          ? {
              fileName: prevEntry.fileName,
              mimeType: prevEntry.mimeType,
              byteSize: prevEntry.byteSize,
              durationSeconds: prevEntry.durationSeconds,
              sha256: prevEntry.sha256,
              playbackUrl: prevEntry.playbackUrl,
            }
          : null,
      };
      STATE.leftMembers.push(leftEntry);
      toastMember('left', leftEntry);
      sendWebhookMemberLeft(room, leftEntry);
      changed = true;
    });

    if (changed) saveToLS(LS_LEFT_PREFIX, room.id, STATE.leftMembers);
  }

  function detectJoinedMembers(room) {
    const prevMemberById = STATE.memberById || {};
    const prevIds = new Set(Object.keys(prevMemberById));
    if (!prevIds.size) return;
    const alreadyLoggedIds = new Set(STATE.joinedMembers.map((j) => j.userId));
    let changed = false;

    (room.members || []).forEach((m) => {
      if (prevIds.has(m.userId) || alreadyLoggedIds.has(m.userId)) return;
      const entry = {
        userId: m.userId,
        name: m.name,
        displayName: m.displayName,
        avatarUrl: m.avatarUrl,
        nameColorKey: m.nameColorKey,
        joinedAt: new Date().toISOString(),
      };
      STATE.joinedMembers.push(entry);
      toastMember('joins', entry);
      sendWebhookMemberJoined(room, entry);
      changed = true;
    });

    if (changed) saveToLS(LS_JOINED_PREFIX, room.id, STATE.joinedMembers);
  }

  function ratingFor(rawScore) {
    return rawScore + 3;
  }

  function formatAvgRating(score, divisor) {
    if (score == null || !divisor) return null;
    return (score / divisor + 3).toFixed(1);
  }

  function computeScores(room) {
    const scores = {};
    const votesByUserId = room.votesByUserId || {};
    Object.keys(votesByUserId).forEach((voterId) => {
      (votesByUserId[voterId] || []).forEach((v) => {
        if (!scores[v.targetId]) scores[v.targetId] = { sum: 0, count: 0 };
        scores[v.targetId].sum += v.score;
        scores[v.targetId].count += 1;
      });
    });
    return scores;
  }

  function processKickVote(room) {
    if (STATE.kickHistoryRoomId !== room.id) {
      STATE.kickHistory = loadFromLS(LS_KICK_PREFIX, room.id);
      STATE.kickHistoryRoomId = room.id;
    }
    const hist = STATE.kickHistory;
    const active = room.activeKickVote;
    let current = hist.find((h) => h.status === 'pending');

    if (active) {
      const key = active.startedAt + '|' + active.targetUserId;
      let isNewVote = false;
      if (!current || current.key !== key) {
        if (current) current.status = 'superseded';
        current = {
          key,
          targetUserId: active.targetUserId,
          targetName: nameFor(active.targetUserId),
          initiatedByUserId: active.initiatedByUserId,
          initiatorName: nameFor(active.initiatedByUserId),
          startedAt: active.startedAt,
          expiresAt: active.expiresAt,
          voterUserIds: [],
          voterNames: [],
          status: 'pending',
        };
        hist.push(current);
        toastKick(`kick vote started: ${current.targetName}`, `by ${current.initiatorName}`, 'warn');
        sendWebhookKickEvent(room, current, 'started');
        isNewVote = true;
      }
      const prevVoterIds = current.voterUserIds;
      const newVoterIds = active.voterUserIds.filter((id) => !prevVoterIds.includes(id));
      current.voterUserIds = active.voterUserIds.slice();
      current.voterNames = active.voterUserIds.map(nameFor);
      current.expiresAt = active.expiresAt;
      if (!isNewVote) {
        newVoterIds.forEach((voterId) => {
          toastKick(`${nameFor(voterId)} voted to kick ${current.targetName}`, `${current.voterUserIds.length} vote${current.voterUserIds.length === 1 ? '' : 's'} so far`, 'warn');
          sendWebhookKickVoteCast(room, current, voterId);
        });
      }
    } else if (current) {
      current.status = (room.kickedUserIds || []).includes(current.targetUserId) ? 'kicked' : 'not kicked';
      current.endedAt = new Date().toISOString();
      toastKick(`kick vote resolved: ${current.targetName}`, current.status, current.status === 'kicked' ? 'bad' : 'good');
      sendWebhookKickEvent(room, current, 'resolved');
    }

    saveToLS(LS_KICK_PREFIX, room.id, hist);
  }

  function sendWebhookKickEvent(room, k, phase) {
    if (!STATE.webhookUrl || !STATE.webhookToggles.kicks) return;
    const title = phase === 'started'
      ? `Kick vote started: ${k.targetName}`
      : `Kick vote resolved: ${k.targetName} - ${k.status}`;
    postWebhook(STATE.webhookUrl, {
      username: 'BeatBattleX',
      embeds: [{
        title,
        fields: [
          { name: 'Target', value: k.targetName || '?', inline: true },
          { name: 'Started by', value: k.initiatorName || '?', inline: true },
          { name: 'Voters', value: k.voterNames.join(', ') || 'none', inline: false },
        ],
        color: phase === 'started' ? 0xffd27f : 0xff8f8f,
      }],
    });
  }

  function sendWebhookKickVoteCast(room, k, voterId) {
    if (!STATE.webhookUrl || !STATE.webhookToggles.kicks) return;
    postWebhook(STATE.webhookUrl, {
      username: 'BeatBattleX',
      embeds: [{
        title: `${nameFor(voterId)} voted to kick ${k.targetName}`,
        fields: [
          { name: 'Target', value: k.targetName || '?', inline: true },
          { name: 'Votes so far', value: `${k.voterUserIds.length}`, inline: true },
          { name: 'All voters', value: k.voterNames.join(', ') || 'none', inline: false },
        ],
        color: 0xffd27f,
      }],
    });
  }

  const NAME_COLORS = {
    rose: '#dd93ac',
    gold: '#ddc088',
    devotion: '#dd8f8f',
    amethyst: '#ad9cdd',
    dusk: '#8fa8dd',
  };

  function nameColorFor(key) {
    return (key && NAME_COLORS[key]) || null;
  }

  function nameStyleAttr(key) {
    const color = nameColorFor(key);
    return color ? ` style="color:${color}"` : '';
  }

  function postWebhook(url, payload) {
    if (!url) return;
    const body = JSON.stringify(payload);
    console.log('[BB overlay] sending webhook payload:', payload);
    if (typeof GM_xmlhttpRequest === 'function') {
      try {
        GM_xmlhttpRequest({
          method: 'POST',
          url,
          headers: { 'Content-Type': 'application/json' },
          data: body,
          onload: (res) => console.log('[BB overlay] webhook response:', res.status, res.responseText),
          onerror: (e) => console.error('[BB overlay] webhook send failed', e),
        });
        return;
      } catch (e) {
        console.error('[BB overlay] GM_xmlhttpRequest failed, falling back to fetch', e);
      }
    }
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      .then((res) => res.text().then((text) => console.log('[BB overlay] webhook response:', res.status, text)))
      .catch((e) => console.error('[BB overlay] webhook fetch failed', e));
  }

  function sendWebhookRoomJoined(room) {
    if (!STATE.webhookUrl) return;
    const fields = [
      { name: 'Room code', value: room.code || '?', inline: true },
      { name: 'Genre', value: room.genre || '?', inline: true },
      { name: 'Mode', value: `${room.matchMode || '?'} / ${room.gameplayMode || '?'}`, inline: true },
      { name: 'Players', value: `${room.memberCount != null ? room.memberCount : (room.members || []).length}/${room.maxPlayers || '?'}`, inline: true },
      { name: 'Timer', value: room.timerMinutes != null ? room.timerMinutes + 'm' : '?', inline: true },
      { name: 'Host', value: (room.host && room.host.displayName) || '?', inline: true },
      { name: 'Phase', value: `${room.phase || '?'} / ${room.gameState || '?'}`, inline: true },
      { name: 'Join link', value: room.joinUrl || '?', inline: false },
    ];
    postWebhook(STATE.webhookUrl, {
      username: 'BeatBattleX',
      embeds: [{
        title: `Joined room: ${room.name || room.code || room.id}`,
        url: room.joinUrl || undefined,
        fields,
        color: 0x7fd1ff,
      }],
    });
  }

  function memberEmbed(member, title, color, extraFields) {
    return {
      title: `${title}: ${member.displayName || member.name || member.userId}`,
      url: member.name ? 'https://beat-battle.net/profile/' + encodeURIComponent(member.name) : undefined,
      thumbnail: member.avatarUrl ? { url: member.avatarUrl } : undefined,
      fields: [
        { name: 'Display name', value: member.displayName || '?', inline: true },
        { name: 'Username', value: member.name || '?', inline: true },
      ].concat(extraFields || []),
      color,
    };
  }

  function sendWebhookMemberJoined(room, m) {
    if (!STATE.webhookUrl || !STATE.webhookToggles.joins) return;
    postWebhook(STATE.webhookUrl, {
      username: 'BeatBattleX',
      embeds: [memberEmbed(m, 'Joined the room', 0x7fffb0)],
    });
  }

  function sendWebhookMemberLeft(room, l) {
    if (!STATE.webhookUrl || !STATE.webhookToggles.left) return;
    postWebhook(STATE.webhookUrl, {
      username: 'BeatBattleX',
      embeds: [memberEmbed(l, l.kicked ? 'Kicked from the room' : 'Left the room', 0xff8f8f,
        [{ name: 'Had uploaded', value: l.upload ? l.upload.fileName : 'no', inline: true }])],
    });
  }

  function sendWebhookUpload(room, entry) {
    if (!STATE.webhookUrl || !STATE.webhookToggles.uploads) return;
    const sizeKb = entry.byteSize ? Math.round(entry.byteSize / 1024) : '?';
    const fields = [
      { name: 'Display name', value: entry.displayName || '?', inline: true },
      { name: 'Username', value: entry.name || '?', inline: true },
    ];
    fields.push(
      { name: 'File', value: `${entry.mimeType || '?'} · ${sizeKb}kb · ${entry.durationSeconds ? Math.round(entry.durationSeconds) + 's' : '?'}`, inline: false },
      { name: 'SHA256', value: entry.sha256 ? entry.sha256.slice(0, 6) : '?', inline: true }
    );
    if (entry.dupeWith && entry.dupeWith.length) {
      fields.push({ name: 'Dupe of', value: entry.dupeWith.join(', '), inline: true });
    }
    postWebhook(STATE.webhookUrl, {
      username: 'BeatBattleX',
      embeds: [{
        title: entry.fileName || 'new upload',
        url: entry.playbackUrl || undefined,
        description: `New upload in room ${room.code || room.id}`,
        fields,
        color: 0x8f7cff,
      }],
    });
  }

  function sendWebhookResults(room, ranked) {
    if (!STATE.webhookUrl || !STATE.webhookToggles.results) return;
    const fields = ranked.slice(0, 10).map((e, i) => {
      const avgRating = formatAvgRating(e.score, e.expectedVotes);
      return {
        name: `#${i + 1} ${e.displayName}`,
        value: `${e.fileName} - ${avgRating != null ? `${avgRating}/5` : 'no votes'} (${e.voteCount} votes)`,
        inline: false,
      };
    });
    postWebhook(STATE.webhookUrl, {
      username: 'BeatBattleX',
      embeds: [{
        title: `Final results - room ${room.code || room.id}`,
        fields: fields.length ? fields : [{ name: 'No results', value: 'no uploads scored', inline: false }],
        color: 0x7fffb0,
      }],
    });
  }

  function sendWebhookNowPlaying(room, scheduleEntry) {
    if (!STATE.webhookUrl || !STATE.webhookToggles.nowPlaying) return;
    const entry = STATE.entries.find((e) => e.userId === scheduleEntry.userId);
    const npFields = [
      { name: 'Display name', value: (entry && entry.displayName) || nameFor(scheduleEntry.userId), inline: true },
      { name: 'Username', value: (entry && entry.name) || '?', inline: true },
    ];
    postWebhook(STATE.webhookUrl, {
      username: 'BeatBattleX',
      embeds: [{
        title: `Now playing: ${(entry && entry.fileName) || 'unknown file'}`,
        url: scheduleEntry.playbackUrl || undefined,
        fields: npFields,
        color: 0x7fd1ff,
      }],
    });
  }

  function sendWebhookRatingVote(room, ev) {
    if (!STATE.webhookUrl || !STATE.webhookToggles.votes) return;
    const targetEntry = STATE.entries.find((e) => e.userId === ev.targetId);
    const changed = ev.prevScore != null;
    const fields = [
      { name: 'Voter', value: nameFor(ev.voterId), inline: true },
      { name: 'Target', value: nameFor(ev.targetId), inline: true },
      { name: 'Rating', value: `${ratingFor(ev.score)}/5`, inline: true },
    ];
    if (changed) fields.push({ name: 'Was', value: `${ratingFor(ev.prevScore)}/5`, inline: true });
    fields.push({ name: 'File', value: (targetEntry && targetEntry.fileName) || '?', inline: false });
    postWebhook(STATE.webhookUrl, {
      username: 'BeatBattleX',
      embeds: [{
        title: changed
          ? `${nameFor(ev.voterId)} changed their rating of ${nameFor(ev.targetId)}'s beat`
          : `${nameFor(ev.voterId)} rated ${nameFor(ev.targetId)}'s beat`,
        fields,
        color: changed ? 0xffd27f : 0x7fffb0,
      }],
    });
  }

  function saveRatingVotes(roomId) {
    try {
      localStorage.setItem(LS_RATING_VOTES_PREFIX + roomId, JSON.stringify(STATE.ratingVotes));
    } catch (e) {}
  }

  function splitVoteKey(key) {
    const i = key.indexOf('|');
    return { voterId: key.slice(0, i), targetId: key.slice(i + 1) };
  }

  function detectRatingVotes(room) {
    if (STATE.ratingVotesRoomId !== room.id) {
      let raw = null;
      try {
        raw = localStorage.getItem(LS_RATING_VOTES_PREFIX + room.id);
      } catch (e) {}
      let parsed = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch (e) {}
      STATE.ratingVotesNeedsSeed = raw === null;
      STATE.ratingVotes = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
      STATE.ratingVotesRoomId = room.id;
    }

    const votesByUserId = room.votesByUserId || {};
    const current = {};
    Object.keys(votesByUserId).forEach((voterId) => {
      (votesByUserId[voterId] || []).forEach((v) => {
        current[voterId + '|' + v.targetId] = v.score;
      });
    });

    if (STATE.ratingVotesNeedsSeed) {
      STATE.ratingVotes = current;
      STATE.ratingVotesNeedsSeed = false;
      saveRatingVotes(room.id);
      return;
    }

    const events = [];
    Object.keys(current).forEach((key) => {
      const score = current[key];
      const prev = STATE.ratingVotes[key];
      if (prev === score) return;
      const { voterId, targetId } = splitVoteKey(key);
      events.push({ voterId, targetId, score, prevScore: prev === undefined ? null : prev });
      STATE.ratingVotes[key] = score;
    });
    if (!events.length) return;

    saveRatingVotes(room.id);

    // A voter submitting a whole card lands as one snapshot: N events at once.
    // One toast each would blow past TOAST_MAX and evict itself in the same tick,
    // so group per voter and show a single summary.
    const byVoter = {};
    events.forEach((ev) => {
      (byVoter[ev.voterId] = byVoter[ev.voterId] || []).push(ev);
      sendWebhookRatingVote(room, ev);
    });
    Object.keys(byVoter).forEach((voterId) => {
      const list = byVoter[voterId];
      if (list.length === 1) toastRatingVote(list[0]);
      else toastRatingBatch(voterId, list);
    });
  }

  function notifyNewUploads(room, entries) {
    const uploadedIds = entries.filter((e) => e.hasUploaded).map((e) => e.userId);
    if (STATE.notifiedUploadsNeedsSeed) {
      STATE.notifiedUploads = uploadedIds.slice();
      STATE.notifiedUploadsNeedsSeed = false;
      saveToLS(LS_NOTIFIED_PREFIX, room.id, STATE.notifiedUploads);
      return;
    }
    let changed = false;
    entries.forEach((e) => {
      if (!e.hasUploaded || STATE.notifiedUploads.includes(e.userId)) return;
      STATE.notifiedUploads.push(e.userId);
      changed = true;
      toastUpload(e);
      sendWebhookUpload(room, e);
    });
    if (changed) saveToLS(LS_NOTIFIED_PREFIX, room.id, STATE.notifiedUploads);
  }

  function sendWebhookChatMessage(m) {
    if (!STATE.webhookUrl || !STATE.webhookToggles.chat || !m.text) return;
    postWebhook(STATE.webhookUrl, {
      username: (m.displayName || m.name || 'unknown').slice(0, 80),
      avatar_url: avatarForChatMsg(m) || undefined,
      content: String(m.text).slice(0, 2000),
      allowed_mentions: { parse: [] },
    });
  }

  function notifyNewChatMessages(roomId) {
    if (STATE.notifiedChatRoomId !== roomId) {
      let raw = null;
      try {
        raw = localStorage.getItem(LS_NOTIFIED_CHAT_PREFIX + roomId);
      } catch (e) {}
      STATE.notifiedChatNeedsSeed = raw === null;
      STATE.notifiedChatIds = loadFromLS(LS_NOTIFIED_CHAT_PREFIX, roomId);
      STATE.notifiedChatRoomId = roomId;
    }

    if (STATE.notifiedChatNeedsSeed) {
      STATE.notifiedChatIds = STATE.chatMessages.map((m) => m.id);
      STATE.notifiedChatNeedsSeed = false;
      saveToLS(LS_NOTIFIED_CHAT_PREFIX, roomId, STATE.notifiedChatIds);
      return;
    }

    if (!STATE.webhookUrl) return;
    let changed = false;
    STATE.chatMessages.forEach((m) => {
      if (STATE.notifiedChatIds.includes(m.id)) return;
      sendWebhookChatMessage(m);
      STATE.notifiedChatIds.push(m.id);
      changed = true;
    });
    if (changed) saveToLS(LS_NOTIFIED_CHAT_PREFIX, roomId, STATE.notifiedChatIds);
  }

  function handleChatMessages(roomId, messages) {
    if (!roomId || !messages.length) return;
    if (STATE.chatRoomId !== roomId) {
      STATE.chatMessages = loadFromLS(LS_CHAT_PREFIX, roomId);
      STATE.chatRoomId = roomId;
    }
    const byId = {};
    STATE.chatMessages.forEach((m) => (byId[m.id] = m));
    messages.forEach((m) => {
      byId[m.id] = m;
    });
    STATE.chatMessages = Object.values(byId).sort(
      (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
    );
    saveToLS(LS_CHAT_PREFIX, roomId, STATE.chatMessages);
    renderChat();
    notifyNewChatMessages(roomId);
  }

  let toggleBtn, panel, listEl, statusEl, copyBtn, kickHistEl, membersEl, resultsEl, joinedMembersEl, leftMembersEl, chatEl, chatLogEl, chatCopyBtn, webhookInput, webhookSaveBtn;
  let hudEl, hudPhaseEl, hudMetaEl, hudProgressEl, hudRowsEl, hudShowBtn, toastWrap;
  let tabsEl, toolbarEl, viewsEl, searchInput, sortSelect, muteBtn, headRoomEl;
  let toggleDotEl, toggleLabelEl, downloadBtn;
  const viewEls = {};
  let uiQuery = '';

  function ensureUI() {
    if (toggleBtn) return;

    const style = document.createElement('style');
    style.textContent = `
      :root {
        --bb2-bg: #0f0f12;
        --bb2-surface: #17181c;
        --bb2-surface-hover: #1f2027;
        --bb2-border: rgba(255,255,255,0.07);
        --bb2-border-strong: rgba(255,255,255,0.15);
        --bb2-ink: #eceef2;
        --bb2-muted: #9aa0aa;
        --bb2-muted-soft: #676d77;
        --bb2-accent: #c9f24a;
        --bb2-accent-soft: #e6ffab;
        --bb2-positive: #5fcf9a;
        --bb2-positive-bg: rgba(95,207,154,0.13);
        --bb2-negative: #e3746c;
        --bb2-negative-bg: rgba(227,116,108,0.13);
        --bb2-warning: #e6b45c;
        --bb2-info: #7fb2d9;
        --bb2-font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        --bb2-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      }

      #bb-overlay-toggle {
        position: fixed; bottom: 10px; right: 10px; z-index: 999999;
        display: flex; align-items: center; gap: 7px;
        background: var(--bb2-bg); color: var(--bb2-ink);
        border: 1px solid var(--bb2-border-strong); border-radius: 5px;
        padding: 6px 11px 6px 9px;
        font: 500 12.5px/1 var(--bb2-font);
        cursor: pointer; user-select: none;
        transition: border-color .15s, background .15s, color .35s;
      }
      #bb-overlay-toggle:hover { background: var(--bb2-surface); border-color: var(--bb2-muted-soft); }
      #bb-overlay-toggle.bb-flash { color: var(--bb2-positive); border-color: var(--bb2-positive); }
      #bb-toggle-label { font-variant-numeric: tabular-nums; }
      .bb-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; background: var(--bb2-muted-soft); transition: background .3s; }
      .bb-dot.bb-live { background: var(--bb2-accent); box-shadow: 0 0 0 3px rgba(201,242,74,.13); }
      .bb-dot.bb-stale { background: var(--bb2-warning); }

      #bb-overlay-panel {
        position: fixed; bottom: 48px; right: 10px; z-index: 999999;
        width: 404px; max-width: calc(100vw - 20px);
        max-height: min(78vh, 780px);
        display: none; flex-direction: column;
        background: var(--bb2-bg); color: var(--bb2-ink);
        border: 1px solid var(--bb2-border-strong); border-radius: 6px;
        font: 400 13px/1.5 var(--bb2-font);
        box-shadow: 0 18px 44px rgba(0,0,0,.55);
        overflow: hidden;
      }
      #bb-overlay-panel.open { display: flex; }
      #bb-overlay-panel a { color: var(--bb2-info); text-decoration: none; }
      #bb-overlay-panel a:hover { text-decoration: underline; }
      #bb-overlay-panel button {
        background: var(--bb2-surface); color: var(--bb2-ink);
        border: 1px solid var(--bb2-border-strong); border-radius: 4px;
        padding: 6px 10px; font: 500 11.5px var(--bb2-font); cursor: pointer;
        transition: background .15s, border-color .15s, color .15s;
      }
      #bb-overlay-panel button:hover { background: var(--bb2-surface-hover); border-color: var(--bb2-muted-soft); }
      #bb-overlay-panel button.bb-copied { color: var(--bb2-accent); border-color: var(--bb2-accent); }
      .bb-btn-row { display: flex; flex-wrap: wrap; gap: 6px; }

      #bb-head {
        display: flex; align-items: center; gap: 8px; flex: none;
        padding: 9px 10px; background: var(--bb2-surface);
        border-bottom: 1px solid var(--bb2-border);
      }
      #bb-head-title { font-weight: 650; font-size: 13px; letter-spacing: -.01em; }
      #bb-head-title .bb-x { color: var(--bb2-accent); }
      #bb-head-room { font: 500 11px var(--bb2-mono); color: var(--bb2-muted); }
      .bb-spacer { flex: 1; }
      #bb-overlay-panel button.bb-icon-btn {
        background: none; border-color: transparent; color: var(--bb2-muted);
        padding: 3px 7px; font-size: 11px;
      }
      #bb-overlay-panel button.bb-icon-btn:hover { color: var(--bb2-ink); background: var(--bb2-surface-hover); border-color: var(--bb2-border); }
      #bb-overlay-panel button.bb-icon-btn.bb-on { color: var(--bb2-accent); border-color: var(--bb2-border-strong); }

      #bb-status { flex: none; padding: 9px 10px; border-bottom: 1px solid var(--bb2-border); }
      #bb-status:empty { display: none; }
      .bb-room-line { display: flex; align-items: center; gap: 7px; margin-bottom: 4px; }
      .bb-room-name { font-weight: 600; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .bb-room-code { font: 500 11px var(--bb2-mono); color: var(--bb2-accent); flex: none; }
      .bb-pill {
        flex: none; font: 500 10px var(--bb2-font); letter-spacing: .02em;
        border: 1px solid var(--bb2-border-strong); border-radius: 20px;
        padding: 1px 7px; color: var(--bb2-muted); white-space: nowrap;
      }
      .bb-facts { display: flex; flex-wrap: wrap; gap: 1px 14px; color: var(--bb2-muted); font-size: 11.5px; }
      .bb-fact b { font: 500 11.5px var(--bb2-mono); color: var(--bb2-ink); }
      .bb-timer { font-family: var(--bb2-mono); color: var(--bb2-warning); }
      .bb-timer.bb-urgent { color: var(--bb2-negative); animation: bb-pulse 1s ease-in-out infinite; }
      @keyframes bb-pulse { 50% { opacity: .4; } }
      .bb-note { margin-top: 5px; font-size: 12px; color: var(--bb2-muted); }
      .bb-note.bb-playing { color: var(--bb2-positive); }
      .bb-note.bb-kick { color: var(--bb2-negative); }
      .bb-note b { font-weight: 600; color: var(--bb2-ink); }

      #bb-tabs { display: flex; flex: none; gap: 1px; padding: 0 5px; border-bottom: 1px solid var(--bb2-border); }
      #bb-overlay-panel button.bb-tab {
        background: none; border: none; border-bottom: 2px solid transparent;
        color: var(--bb2-muted-soft); padding: 8px 9px 6px; margin-bottom: -1px;
        font: 500 12px var(--bb2-font); border-radius: 0;
      }
      #bb-overlay-panel button.bb-tab:hover { color: var(--bb2-ink); background: none; }
      #bb-overlay-panel button.bb-tab.bb-active { color: var(--bb2-ink); border-bottom-color: var(--bb2-accent); }
      .bb-tab-badge { margin-left: 5px; font: 500 10px var(--bb2-mono); color: var(--bb2-muted-soft); }
      .bb-tab.bb-active .bb-tab-badge { color: var(--bb2-accent); }

      #bb-toolbar { display: flex; flex: none; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--bb2-border); }
      #bb-toolbar[hidden] { display: none; }
      #bb-search, #bb-sort {
        background: var(--bb2-surface); color: var(--bb2-ink);
        border: 1px solid var(--bb2-border); border-radius: 4px;
        font: 400 12px var(--bb2-font);
      }
      #bb-search { flex: 1; min-width: 0; padding: 5px 8px; }
      #bb-search::placeholder { color: var(--bb2-muted-soft); }
      #bb-sort { padding: 5px 6px; color: var(--bb2-muted); font-size: 11.5px; cursor: pointer; }
      #bb-search:focus, #bb-sort:focus, #bb-webhook-input:focus, #bb-known-users-webhook-input:focus {
        outline: none; border-color: var(--bb2-accent);
      }

      #bb-views { flex: 1; overflow-y: auto; padding: 10px; }
      #bb-views::-webkit-scrollbar { width: 11px; }
      #bb-views::-webkit-scrollbar-thumb {
        background: var(--bb2-surface-hover); border-radius: 6px; border: 3px solid var(--bb2-bg);
      }
      #bb-chat-log::-webkit-scrollbar { width: 9px; }
      #bb-chat-log::-webkit-scrollbar-thumb { background: var(--bb2-surface-hover); border-radius: 5px; }
      .bb-view[hidden] { display: none; }
      .bb-view > div + div { margin-top: 15px; }
      .bb-view > div:empty { display: none; margin: 0; }

      .bb-section-title {
        display: flex; align-items: center; gap: 8px;
        font: 600 12px var(--bb2-font); color: var(--bb2-ink); margin: 0 0 8px;
      }
      .bb-section-title::after { content: ''; flex: 1; height: 1px; background: var(--bb2-border); }
      .bb-count { font: 500 11px var(--bb2-mono); color: var(--bb2-muted-soft); }
      .bb-empty { color: var(--bb2-muted-soft); font-size: 12px; }
      #bb-overlay-panel .bb-meta { color: var(--bb2-muted); font-size: 11.5px; }
      #bb-overlay-panel .bb-mono { font-family: var(--bb2-mono); }

      #bb-overlay-panel .bb-entry {
        padding: 8px 9px; margin-bottom: 6px; border-radius: 5px;
        background: var(--bb2-surface); border: 1px solid transparent;
        word-break: break-word;
      }
      #bb-overlay-panel .bb-entry:hover { border-color: var(--bb2-border-strong); }
      #bb-overlay-panel .bb-entry.bb-no-upload { background: none; border: 1px dashed var(--bb2-border); }
      #bb-overlay-panel .bb-entry.bb-left { opacity: .68; }
      #bb-overlay-panel .bb-fn {
        font: 500 12.5px var(--bb2-mono); color: var(--bb2-ink);
        margin-bottom: 2px; word-break: break-all;
      }
      #bb-overlay-panel .bb-fn.bb-meta { color: var(--bb2-muted-soft); font-family: var(--bb2-font); }
      #bb-overlay-panel .bb-who { font-size: 12.5px; }
      #bb-overlay-panel .bb-score { font: 500 12px var(--bb2-mono); color: var(--bb2-positive); }
      #bb-overlay-panel .bb-score.neg { color: var(--bb2-negative); }
      #bb-overlay-panel .bb-dupe { color: var(--bb2-negative); font-weight: 600; font-size: 11.5px; }
      .bb-name { cursor: pointer; }
      .bb-name:hover { text-decoration: underline dotted; text-underline-offset: 2px; }
      .bb-copied-flash { color: var(--bb2-accent) !important; }

      #bb-members .bb-member-row {
        display: flex; align-items: center; gap: 8px;
        padding: 5px 6px; border-radius: 4px;
      }
      #bb-members .bb-member-row:hover { background: var(--bb2-surface); }
      .bb-ready-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; background: var(--bb2-muted-soft); }
      .bb-ready-dot.bb-is-ready { background: var(--bb2-positive); }
      .bb-name-cell { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
      .bb-member-tags { flex: none; display: flex; gap: 6px; font-size: 10.5px; color: var(--bb2-muted-soft); }

      #bb-results .bb-result-row {
        display: flex; gap: 9px; align-items: baseline;
        padding: 5px 6px; border-radius: 4px; font-size: 12.5px;
      }
      #bb-results .bb-result-row:nth-child(odd) { background: var(--bb2-surface); }
      #bb-results .bb-rank { flex: none; min-width: 22px; font: 600 11px var(--bb2-mono); color: var(--bb2-muted-soft); }
      #bb-results .bb-result-row.bb-first .bb-rank { color: var(--bb2-accent); }
      #bb-results .bb-result-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #bb-results .bb-result-score { flex: none; font: 500 12px var(--bb2-mono); }

      .bb-log-entry {
        padding: 6px 8px; margin-bottom: 5px; border-radius: 5px;
        background: var(--bb2-surface); font-size: 12px;
        border-left: 2px solid var(--bb2-border-strong);
      }
      .bb-log-entry.bb-log-in { border-left-color: var(--bb2-positive); }
      .bb-log-entry.bb-log-out { border-left-color: var(--bb2-negative); }
      .bb-log-entry.bb-log-kick { border-left-color: var(--bb2-warning); }
      .bb-when { font: 400 10.5px var(--bb2-mono); color: var(--bb2-muted-soft); }

      #bb-chat-top { color: var(--bb2-muted-soft); font-size: 11.5px; margin-bottom: 7px; }
      #bb-chat-log {
        max-height: 320px; overflow-y: auto;
        background: var(--bb2-surface); border: 1px solid var(--bb2-border);
        border-radius: 5px; padding: 7px 9px;
      }
      #bb-chat-log .bb-chat-row { margin: 3px 0; word-break: break-word; font-size: 12.5px; }
      #bb-chat-log .bb-chat-time { font: 400 10.5px var(--bb2-mono); color: var(--bb2-muted-soft); margin-right: 3px; }
      #bb-chat-log .bb-chat-name { font-weight: 600; }
      #bb-chat-log .bb-chat-avatar {
        width: 14px; height: 14px; border-radius: 50%;
        vertical-align: -2px; margin-right: 4px; object-fit: cover;
      }

      .bb-toggle-grid { display: flex; flex-wrap: wrap; gap: 5px 14px; margin: 7px 0 10px; }
      .bb-webhook-toggle {
        display: inline-flex; align-items: center; gap: 5px;
        font-size: 11.5px; color: var(--bb2-muted); cursor: pointer;
      }
      .bb-webhook-toggle input { accent-color: var(--bb2-accent); margin: 0; }
      #bb-webhook-input, #bb-known-users-webhook-input {
        display: block; width: 100%; box-sizing: border-box; margin-bottom: 8px;
        background: var(--bb2-surface); color: var(--bb2-ink);
        border: 1px solid var(--bb2-border); border-radius: 4px;
        padding: 6px 8px; font: 400 11.5px var(--bb2-mono);
      }
      #bb-known-users button { margin: 0 5px 5px 0; }
      .bb-hint { color: var(--bb2-muted-soft); font-size: 11px; margin: -2px 0 8px; }
      .bb-keys { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 11px; color: var(--bb2-muted-soft); }
      .bb-keys kbd {
        font: 500 10.5px var(--bb2-mono); color: var(--bb2-muted);
        border: 1px solid var(--bb2-border-strong); border-bottom-width: 2px;
        border-radius: 3px; padding: 0 4px;
      }

      #bb-credits {
        margin-top: 16px; padding-top: 11px; border-top: 1px solid var(--bb2-border);
        color: var(--bb2-muted-soft); font-size: 11px; line-height: 1.7;
      }
      #bb-credits a { color: var(--bb2-muted); }
      #bb-credits a:hover { color: var(--bb2-ink); text-decoration: none; }
      #bb-credits .bb-discord-cta {
        display: inline-block; margin-top: 8px; padding: 5px 11px;
        border: 1px solid var(--bb2-border-strong); border-radius: 4px;
        color: var(--bb2-accent-soft); font-weight: 600;
      }
      #bb-credits .bb-discord-cta:hover { border-color: var(--bb2-accent); color: var(--bb2-accent); }

      #bb-hud {
        position: fixed; top: 10px; right: 10px; z-index: 999998;
        width: 274px; background: var(--bb2-bg); color: var(--bb2-ink);
        border: 1px solid var(--bb2-border-strong); border-radius: 6px; overflow: hidden;
        font: 400 12.5px/1.45 var(--bb2-font);
        box-shadow: 0 12px 30px rgba(0,0,0,.5);
        display: none;
      }
      #bb-hud.bb-hud-on { display: block; }
      #bb-hud-head {
        display: flex; align-items: center; gap: 7px;
        padding: 7px 9px; background: var(--bb2-surface);
        border-bottom: 1px solid var(--bb2-border); cursor: grab; user-select: none;
      }
      #bb-hud-head:active { cursor: grabbing; }
      #bb-hud-title { font: 600 11.5px var(--bb2-font); letter-spacing: .01em; }
      #bb-hud-phase {
        margin-left: auto; font: 500 10px var(--bb2-mono); color: var(--bb2-muted);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 130px;
      }
      #bb-hud-head button {
        background: none; border: none; color: var(--bb2-muted-soft);
        cursor: pointer; font: 600 13px/1 var(--bb2-font); padding: 2px 4px; border-radius: 3px;
      }
      #bb-hud-head button:hover { color: var(--bb2-ink); background: var(--bb2-surface-hover); }
      #bb-hud.bb-collapsed #bb-hud-body { display: none; }
      #bb-hud-body { padding: 9px; }
      #bb-hud-meta { color: var(--bb2-muted); font-size: 11px; margin-bottom: 7px; word-break: break-word; }
      #bb-hud-meta .bb-hud-timer { font-family: var(--bb2-mono); color: var(--bb2-warning); }
      #bb-hud-meta .bb-hud-timer.bb-urgent { color: var(--bb2-negative); }
      #bb-hud-progress { margin-bottom: 9px; }
      #bb-hud-progress .bb-hud-prog-label {
        display: flex; justify-content: space-between;
        font: 500 10px var(--bb2-mono); color: var(--bb2-muted-soft); margin-bottom: 4px;
      }
      .bb-hud-track { height: 3px; border-radius: 2px; background: var(--bb2-surface-hover); overflow: hidden; }
      .bb-hud-track > i { display: block; height: 100%; background: var(--bb2-accent); transition: width .35s ease; }
      #bb-hud-rows { display: flex; flex-direction: column; gap: 4px; }
      .bb-hud-row {
        display: grid; grid-template-columns: 15px 20px 1fr auto; gap: 7px;
        align-items: center; padding: 3px 4px; border-radius: 4px;
      }
      .bb-hud-row:hover { background: var(--bb2-surface); }
      .bb-hud-rank { font: 500 10px var(--bb2-mono); color: var(--bb2-muted-soft); text-align: right; }
      .bb-hud-row.bb-hud-top .bb-hud-rank { color: var(--bb2-accent); font-weight: 700; }
      .bb-hud-av { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; background: var(--bb2-surface-hover); }
      .bb-hud-main { min-width: 0; }
      .bb-hud-name { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12px; }
      .bb-hud-sub { display: flex; align-items: center; gap: 6px; margin-top: 3px; }
      .bb-hud-sub .bb-hud-track { flex: 1; }
      .bb-hud-votes { font: 400 9.5px var(--bb2-mono); color: var(--bb2-muted-soft); white-space: nowrap; }
      .bb-hud-val { font: 600 13px var(--bb2-mono); white-space: nowrap; }
      .bb-hud-val small { font-weight: 400; font-size: 9.5px; color: var(--bb2-muted-soft); }
      .bb-tone-good { color: var(--bb2-positive); } .bb-fill-good { background: var(--bb2-positive) !important; }
      .bb-tone-info { color: var(--bb2-info); }     .bb-fill-info { background: var(--bb2-info) !important; }
      .bb-tone-warn { color: var(--bb2-warning); }  .bb-fill-warn { background: var(--bb2-warning) !important; }
      .bb-tone-bad  { color: var(--bb2-negative); } .bb-fill-bad  { background: var(--bb2-negative) !important; }
      .bb-tone-mute { color: var(--bb2-muted-soft); }
      #bb-hud-rows .bb-hud-pending { opacity: .5; }
      #bb-hud-foot {
        margin-top: 9px; padding-top: 8px; border-top: 1px solid var(--bb2-border);
        display: flex; align-items: center; justify-content: space-between;
        font-size: 10px; color: var(--bb2-muted-soft);
      }
      #bb-hud-foot a { color: var(--bb2-muted); text-decoration: none; }
      #bb-hud-foot a:hover { color: var(--bb2-accent); }
      #bb-hud-empty { color: var(--bb2-muted-soft); font-size: 11.5px; }

      #bb-toasts {
        position: fixed; top: 10px; left: 50%; transform: translateX(-50%); z-index: 1000000;
        display: flex; flex-direction: column-reverse; align-items: stretch; gap: 6px;
        width: max-content; max-width: min(92vw, 350px); pointer-events: none;
      }
      .bb-toast {
        display: flex; gap: 9px; align-items: flex-start;
        background: var(--bb2-bg); color: var(--bb2-ink);
        border: 1px solid var(--bb2-border-strong); border-left: 2px solid var(--bb2-accent);
        border-radius: 5px; padding: 8px 11px;
        font: 400 12px/1.4 var(--bb2-font);
        box-shadow: 0 8px 24px rgba(0,0,0,.5);
        cursor: pointer; pointer-events: auto;
        animation: bb-toast-in .22s ease-out;
      }
      .bb-toast:hover { background: var(--bb2-surface); }
      .bb-toast.bb-toast-out { animation: bb-toast-out .18s ease-in forwards; }
      .bb-toast.bb-tone-good { border-left-color: var(--bb2-positive); }
      .bb-toast.bb-tone-info { border-left-color: var(--bb2-info); }
      .bb-toast.bb-tone-warn { border-left-color: var(--bb2-warning); }
      .bb-toast.bb-tone-bad  { border-left-color: var(--bb2-negative); }
      .bb-toast-av { width: 26px; height: 26px; border-radius: 50%; object-fit: cover; flex: none; background: var(--bb2-surface); }
      .bb-toast-text { min-width: 0; }
      .bb-toast-title { font-weight: 600; word-break: break-word; }
      .bb-toast-body { color: var(--bb2-muted); font-size: 11px; word-break: break-word; margin-top: 1px; }
      .bb-toast-stars { letter-spacing: 1px; }
      .bb-toast-count {
        margin-left: 6px; font: 500 10px var(--bb2-mono); color: var(--bb2-muted-soft);
        border: 1px solid var(--bb2-border); border-radius: 10px; padding: 0 5px;
      }
      .bb-toast.bb-toast-bump { animation: bb-toast-bump .3s ease-out; }
      @keyframes bb-toast-in { from { opacity: 0; transform: translateY(-14px) scale(.97); } to { opacity: 1; transform: none; } }
      @keyframes bb-toast-out { to { opacity: 0; transform: translateY(-10px); } }
      @keyframes bb-toast-bump {
        0% { transform: scale(1); } 40% { transform: scale(1.035); } 100% { transform: scale(1); }
      }
      @media (prefers-reduced-motion: reduce) {
        .bb-toast, .bb-toast.bb-toast-out, .bb-toast.bb-toast-bump { animation: none; }
        .bb-hud-track > i { transition: none; }
        .bb-timer.bb-urgent { animation: none; }
      }
    `;
    document.documentElement.appendChild(style);

    toggleBtn = document.createElement('div');
    toggleBtn.id = 'bb-overlay-toggle';
    toggleBtn.title = 'BeatBattleX — alt+B';
    toggleBtn.innerHTML = '<span id="bb-toggle-dot" class="bb-dot"></span><span id="bb-toggle-label">0/0 uploads</span>';
    toggleDotEl = toggleBtn.querySelector('#bb-toggle-dot');
    toggleLabelEl = toggleBtn.querySelector('#bb-toggle-label');
    toggleBtn.addEventListener('click', () => setPanelOpen(!STATE.ui.open));

    panel = document.createElement('div');
    panel.id = 'bb-overlay-panel';

    const head = document.createElement('div');
    head.id = 'bb-head';
    head.innerHTML = `
      <span id="bb-head-title">BeatBattle<span class="bb-x">X</span></span>
      <span id="bb-head-room"></span>
      <span class="bb-spacer"></span>
      <button id="bb-mute-btn" class="bb-icon-btn">toasts</button>
      <button id="bb-hud-btn" class="bb-icon-btn" title="score HUD (alt+H)">HUD</button>
      <button id="bb-close-btn" class="bb-icon-btn" title="close (esc)">&times;</button>
    `;
    headRoomEl = head.querySelector('#bb-head-room');
    muteBtn = head.querySelector('#bb-mute-btn');
    muteBtn.addEventListener('click', () => {
      STATE.ui.muted = !STATE.ui.muted;
      saveUiPrefs();
      syncChrome();
    });
    hudShowBtn = head.querySelector('#bb-hud-btn');
    hudShowBtn.addEventListener('click', () => toggleHud());
    head.querySelector('#bb-close-btn').addEventListener('click', () => setPanelOpen(false));
    panel.appendChild(head);

    statusEl = document.createElement('div');
    statusEl.id = 'bb-status';
    panel.appendChild(statusEl);

    const tabDefs = [
      ['uploads', 'Uploads'],
      ['players', 'Players'],
      ['chat', 'Chat'],
      ['log', 'Log'],
      ['settings', 'Settings'],
    ];
    tabsEl = document.createElement('div');
    tabsEl.id = 'bb-tabs';
    tabsEl.innerHTML = tabDefs.map(([key, label]) =>
      `<button class="bb-tab" data-tab="${key}">${label}<span class="bb-tab-badge" data-badge="${key}" hidden></span></button>`
    ).join('');
    tabsEl.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.bb-tab');
      if (btn) setTab(btn.dataset.tab);
    });
    panel.appendChild(tabsEl);

    toolbarEl = document.createElement('div');
    toolbarEl.id = 'bb-toolbar';
    toolbarEl.innerHTML = `
      <input id="bb-search" type="search" placeholder="filter by name or file…" autocomplete="off" />
      <select id="bb-sort" title="sort uploads">
        <option value="time">upload order</option>
        <option value="rating">rating</option>
        <option value="name">name</option>
        <option value="size">size</option>
      </select>
    `;
    searchInput = toolbarEl.querySelector('#bb-search');
    sortSelect = toolbarEl.querySelector('#bb-sort');
    sortSelect.value = STATE.ui.sort;
    searchInput.addEventListener('input', () => {
      uiQuery = searchInput.value;
      renderPanel();
    });
    sortSelect.addEventListener('change', () => {
      STATE.ui.sort = sortSelect.value;
      saveUiPrefs();
      renderPanel();
    });
    panel.appendChild(toolbarEl);

    viewsEl = document.createElement('div');
    viewsEl.id = 'bb-views';
    tabDefs.forEach(([key]) => {
      const view = document.createElement('div');
      view.className = 'bb-view';
      view.dataset.view = key;
      viewEls[key] = view;
      viewsEl.appendChild(view);
    });
    panel.appendChild(viewsEl);

    listEl = document.createElement('div');
    viewEls.uploads.appendChild(listEl);

    membersEl = document.createElement('div');
    membersEl.id = 'bb-members';
    viewEls.players.appendChild(membersEl);

    chatEl = document.createElement('div');
    chatEl.id = 'bb-chat';
    chatEl.innerHTML = `
      <div class="bb-section-title" id="bb-chat-title">Chat</div>
      <div id="bb-chat-top"></div>
      <div id="bb-chat-log"></div>
    `;
    chatCopyBtn = document.createElement('button');
    chatCopyBtn.id = 'bb-chat-copy-btn';
    chatCopyBtn.textContent = 'copy chat log';
    chatCopyBtn.style.marginTop = '8px';
    chatCopyBtn.addEventListener('click', copyChatReport);
    chatEl.appendChild(chatCopyBtn);
    chatLogEl = chatEl.querySelector('#bb-chat-log');
    viewEls.chat.appendChild(chatEl);

    resultsEl = document.createElement('div');
    resultsEl.id = 'bb-results';
    viewEls.log.appendChild(resultsEl);

    kickHistEl = document.createElement('div');
    kickHistEl.id = 'bb-kick-history';
    viewEls.log.appendChild(kickHistEl);

    joinedMembersEl = document.createElement('div');
    joinedMembersEl.id = 'bb-joined-members';
    viewEls.log.appendChild(joinedMembersEl);

    leftMembersEl = document.createElement('div');
    leftMembersEl.id = 'bb-left-members';
    viewEls.log.appendChild(leftMembersEl);

    const webhookWrap = document.createElement('div');
    webhookWrap.id = 'bb-webhook-wrap';
    const toggleDefs = [
      ['uploads', 'uploads'], ['joins', 'joins'], ['left', 'left'],
      ['chat', 'chat'], ['kicks', 'kicks'], ['votes', 'votes'], ['results', 'results'], ['nowPlaying', 'now playing'],
    ];
    webhookWrap.innerHTML = `
      <div class="bb-section-title">Discord webhook</div>
      <input id="bb-webhook-input" type="text" placeholder="https://discord.com/api/webhooks/..." />
      <div class="bb-toggle-grid" id="bb-webhook-toggles">
        ${toggleDefs.map(([key, label]) => `
          <label class="bb-webhook-toggle">
            <input type="checkbox" data-toggle-key="${key}" ${STATE.webhookToggles[key] ? 'checked' : ''} />
            ${escapeHtml(label)}
          </label>
        `).join('')}
      </div>
    `;
    webhookInput = webhookWrap.querySelector('#bb-webhook-input');
    webhookInput.value = STATE.webhookUrl;
    webhookWrap.querySelectorAll('input[data-toggle-key]').forEach((cb) => {
      cb.addEventListener('change', () => {
        STATE.webhookToggles[cb.dataset.toggleKey] = cb.checked;
        setWebhookToggles(STATE.webhookToggles);
      });
    });
    webhookSaveBtn = document.createElement('button');
    webhookSaveBtn.id = 'bb-webhook-save-btn';
    webhookSaveBtn.textContent = 'save webhook';
    webhookSaveBtn.addEventListener('click', () => {
      const val = webhookInput.value.trim();
      STATE.webhookUrl = val;
      setWebhookUrl(val);
      webhookSaveBtn.textContent = 'saved';
      webhookSaveBtn.classList.add('bb-copied');
      setTimeout(() => {
        webhookSaveBtn.textContent = 'save webhook';
        webhookSaveBtn.classList.remove('bb-copied');
      }, 1200);
    });
    webhookWrap.appendChild(webhookSaveBtn);
    viewEls.settings.appendChild(webhookWrap);

    const toastPrefs = document.createElement('div');
    const toastDefs = [
      ['votes', 'ratings'], ['kicks', 'kick votes'], ['uploads', 'uploads'],
      ['joins', 'joins'], ['left', 'leaves'], ['results', 'results'],
    ];
    toastPrefs.innerHTML = `
      <div class="bb-section-title">On-screen toasts</div>
      <div class="bb-toggle-grid">
        ${toastDefs.map(([key, label]) => `
          <label class="bb-webhook-toggle">
            <input type="checkbox" data-toast-key="${key}" ${STATE.toastToggles[key] ? 'checked' : ''} />
            ${escapeHtml(label)}
          </label>
        `).join('')}
      </div>
      <label class="bb-webhook-toggle">
        <input type="checkbox" id="bb-sound-toggle" ${STATE.ui.sound ? 'checked' : ''} />
        play a short cue on uploads and results
      </label>
    `;
    toastPrefs.querySelectorAll('input[data-toast-key]').forEach((cb) => {
      cb.addEventListener('change', () => {
        STATE.toastToggles[cb.dataset.toastKey] = cb.checked;
        setToastToggles(STATE.toastToggles);
      });
    });
    toastPrefs.querySelector('#bb-sound-toggle').addEventListener('change', (ev) => {
      STATE.ui.sound = ev.target.checked;
      saveUiPrefs();
      if (STATE.ui.sound) playCue(660, 120);
    });
    viewEls.settings.appendChild(toastPrefs);

    const exportWrap = document.createElement('div');
    exportWrap.innerHTML = '<div class="bb-section-title">Export</div>';
    const btnRow = document.createElement('div');
    btnRow.className = 'bb-btn-row';
    copyBtn = document.createElement('button');
    copyBtn.id = 'bb-copy-btn';
    copyBtn.textContent = 'copy report';
    copyBtn.addEventListener('click', copyReport);
    btnRow.appendChild(copyBtn);
    downloadBtn = document.createElement('button');
    downloadBtn.id = 'bb-download-btn';
    downloadBtn.textContent = 'download .txt';
    downloadBtn.addEventListener('click', downloadReport);
    btnRow.appendChild(downloadBtn);
    exportWrap.appendChild(btnRow);
    viewEls.settings.appendChild(exportWrap);

    const keysWrap = document.createElement('div');
    keysWrap.innerHTML = `
      <div class="bb-section-title">Shortcuts</div>
      <div class="bb-keys">
        <span><kbd>alt</kbd>+<kbd>B</kbd> panel</span>
        <span><kbd>alt</kbd>+<kbd>H</kbd> HUD</span>
        <span><kbd>alt</kbd>+<kbd>C</kbd> collapse HUD</span>
        <span><kbd>/</kbd> filter</span>
        <span><kbd>esc</kbd> close</span>
      </div>
    `;
    viewEls.settings.appendChild(keysWrap);

    const credits = document.createElement('div');
    credits.id = 'bb-credits';
    credits.innerHTML = `made by @alshailopezstein96 on Discord`
      + `<br><a href="https://github.com/FaithfullyOSS/BeatBattleX" target="_blank" rel="noopener noreferrer">github.com/FaithfullyOSS/BeatBattleX</a>`
      + `<br><a class="bb-discord-cta" href="${DISCORD_INVITE}" target="_blank" rel="noopener noreferrer">join our Discord</a>`;
    viewEls.settings.appendChild(credits);

    hudEl = document.createElement('div');
    hudEl.id = 'bb-hud';
    hudEl.innerHTML = `
      <div id="bb-hud-head">
        <span id="bb-hud-title">Scores</span>
        <span id="bb-hud-phase"></span>
        <button id="bb-hud-collapse" title="collapse / expand (alt+C)">&minus;</button>
        <button id="bb-hud-close" title="hide HUD (alt+H)">&times;</button>
      </div>
      <div id="bb-hud-body">
        <div id="bb-hud-meta"></div>
        <div id="bb-hud-progress"></div>
        <div id="bb-hud-rows"></div>
        <div id="bb-hud-foot">
          <span>BeatBattleX</span>
          <a href="${DISCORD_INVITE}" target="_blank" rel="noopener noreferrer">join our Discord</a>
        </div>
      </div>
    `;
    hudPhaseEl = hudEl.querySelector('#bb-hud-phase');
    hudMetaEl = hudEl.querySelector('#bb-hud-meta');
    hudProgressEl = hudEl.querySelector('#bb-hud-progress');
    hudRowsEl = hudEl.querySelector('#bb-hud-rows');
    hudEl.querySelector('#bb-hud-collapse').addEventListener('click', () => {
      STATE.hud.collapsed = !STATE.hud.collapsed;
      saveHudPrefs();
      renderHud();
    });
    hudEl.querySelector('#bb-hud-close').addEventListener('click', () => toggleHud(true));
    makeHudDraggable(hudEl.querySelector('#bb-hud-head'));

    toastWrap = document.createElement('div');
    toastWrap.id = 'bb-toasts';

    document.documentElement.appendChild(toggleBtn);
    document.documentElement.appendChild(panel);
    document.documentElement.appendChild(hudEl);
    document.documentElement.appendChild(toastWrap);
    applyHudPosition();

    window.addEventListener('resize', applyHudPosition);
    window.addEventListener('keydown', (ev) => {
      if (ev.ctrlKey || ev.metaKey) return;
      const t = ev.target;
      const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
      const key = (ev.key || '').toLowerCase();

      if (key === 'escape' && STATE.ui.open) {
        if (typing && t === searchInput && searchInput.value) {
          searchInput.value = '';
          uiQuery = '';
          renderPanel();
        } else {
          setPanelOpen(false);
        }
        ev.preventDefault();
        return;
      }
      if (typing) return;
      if (key === '/' && !ev.altKey) {
        if (!STATE.ui.open) setPanelOpen(true);
        setTab('uploads');
        searchInput.focus();
        searchInput.select();
        ev.preventDefault();
        return;
      }
      if (!ev.altKey) return;
      if (key === 'b') { setPanelOpen(!STATE.ui.open); ev.preventDefault(); }
      else if (key === 'h') { toggleHud(); ev.preventDefault(); }
      else if (key === 'c') {
        STATE.hud.collapsed = !STATE.hud.collapsed;
        saveHudPrefs();
        renderHud();
        ev.preventDefault();
      }
    });

    syncChrome();

    setInterval(() => {
      if (STATE.room) renderStatus();
    }, 1000);

    // Relative timestamps in the log tab go stale on their own.
    setInterval(() => {
      if (STATE.ui.open && STATE.ui.tab === 'log') {
        renderJoinedMembers();
        renderLeftMembers();
        renderKickHistory();
      }
    }, 20000);
  }

  function saveUiPrefs() {
    setJsonSetting(LS_UI_KEY, STATE.ui);
  }

  function setPanelOpen(open) {
    STATE.ui.open = !!open;
    saveUiPrefs();
    syncChrome();
    if (STATE.ui.open) renderPanel();
  }

  function setTab(name) {
    if (!viewEls[name]) return;
    STATE.ui.tab = name;
    saveUiPrefs();
    syncChrome();
    renderPanel();
    if (name === 'chat') renderChat();
  }

  // Everything that is chrome rather than data: open state, active tab, the
  // toggle states in the header. Cheap enough to run on any state change.
  function syncChrome() {
    if (!panel) return;
    panel.classList.toggle('open', !!STATE.ui.open);
    if (muteBtn) {
      muteBtn.textContent = STATE.ui.muted ? 'muted' : 'toasts';
      muteBtn.classList.toggle('bb-on', !STATE.ui.muted);
      muteBtn.title = STATE.ui.muted ? 'toasts muted — click to unmute' : 'toasts on — click to mute';
    }
    if (hudShowBtn) {
      hudShowBtn.classList.toggle('bb-on', !STATE.hud.hidden);
      hudShowBtn.title = STATE.hud.hidden ? 'show score HUD (alt+H)' : 'hide score HUD (alt+H)';
    }
    if (tabsEl) {
      tabsEl.querySelectorAll('.bb-tab').forEach((btn) => {
        btn.classList.toggle('bb-active', btn.dataset.tab === STATE.ui.tab);
      });
    }
    Object.keys(viewEls).forEach((key) => { viewEls[key].hidden = key !== STATE.ui.tab; });
    if (toolbarEl) toolbarEl.hidden = STATE.ui.tab !== 'uploads';
  }

  function setBadge(key, value) {
    if (!tabsEl) return;
    const el = tabsEl.querySelector(`[data-badge="${key}"]`);
    if (!el) return;
    el.textContent = value == null ? '' : String(value);
    el.hidden = value == null;
  }

  function timeAgo(value) {
    const t = new Date(value).getTime();
    if (!t) return '';
    const secs = Math.max(0, (Date.now() - t) / 1000);
    if (secs < 45) return 'just now';
    if (secs < 5400) return Math.max(1, Math.round(secs / 60)) + 'm ago';
    return Math.round(secs / 3600) + 'h ago';
  }

  function copyText(text, el) {
    const flash = () => {
      if (!el) return;
      el.classList.add('bb-copied-flash');
      setTimeout(() => el.classList.remove('bb-copied-flash'), 700);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(flash, () => fallbackCopy(text, flash));
    } else {
      fallbackCopy(text, flash);
    }
  }

  function downloadReport() {
    const room = STATE.room;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T-]/g, '');
    const name = `beatbattle-${(room && (room.code || room.id)) || 'room'}-${stamp}.txt`;
    try {
      const blob = new Blob([buildReportText()], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.documentElement.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      flashBtn(downloadBtn, 'saved', 'download .txt');
    } catch (e) {
      console.error('[BB overlay] download failed', e);
      flashBtn(downloadBtn, 'failed', 'download .txt');
    }
  }

  function flashBtn(btn, tempText, restoreText) {
    if (!btn) return;
    btn.textContent = tempText;
    btn.classList.add('bb-copied');
    setTimeout(() => {
      btn.textContent = restoreText;
      btn.classList.remove('bb-copied');
    }, 1400);
  }

  // Short WebAudio blip. Opt-in, and deliberately quiet - this runs on a page
  // the user is already listening to.
  let audioCtx = null;
  function playCue(freq, ms) {
    if (!STATE.ui.sound) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const t0 = audioCtx.currentTime;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.05, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + ms / 1000);
    } catch (e) {}
  }

  function entryMatches(entry, query) {
    if (!query) return true;
    const q = query.toLowerCase();
    return (entry.displayName || '').toLowerCase().indexOf(q) !== -1
      || (entry.name || '').toLowerCase().indexOf(q) !== -1
      || (entry.fileName || '').toLowerCase().indexOf(q) !== -1;
  }

  function sortEntries(entries, mode) {
    const list = entries.slice();
    if (mode === 'name') {
      return list.sort((a, b) => a.displayName.localeCompare(b.displayName));
    }
    if (mode === 'size') {
      return list.sort((a, b) => (b.byteSize || 0) - (a.byteSize || 0));
    }
    if (mode === 'rating') {
      return list.sort((a, b) => {
        const av = a.expectedVotes && a.score != null ? a.score / a.expectedVotes : null;
        const bv = b.expectedVotes && b.score != null ? b.score / b.expectedVotes : null;
        if (av == null && bv == null) return a.displayName.localeCompare(b.displayName);
        if (av == null) return 1;
        if (bv == null) return -1;
        return bv - av;
      });
    }
    return list; // 'time' - STATE.entries is already in upload order
  }

  function toggleHud(forceHide) {
    STATE.hud.hidden = forceHide === true ? true : !STATE.hud.hidden;
    saveHudPrefs();
    syncChrome();
    renderHud();
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function applyHudPosition() {
    if (!hudEl || STATE.hud.x == null || STATE.hud.y == null) return;
    const w = hudEl.offsetWidth || 268;
    hudEl.style.left = clamp(STATE.hud.x, 0, Math.max(0, window.innerWidth - w)) + 'px';
    hudEl.style.top = clamp(STATE.hud.y, 0, Math.max(0, window.innerHeight - 32)) + 'px';
    hudEl.style.right = 'auto';
  }

  function makeHudDraggable(head) {
    let dragging = false;
    let startX = 0, startY = 0, originX = 0, originY = 0;

    head.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0 || (ev.target && ev.target.closest('button'))) return;
      const rect = hudEl.getBoundingClientRect();
      dragging = true;
      startX = ev.clientX; startY = ev.clientY;
      originX = rect.left; originY = rect.top;
      ev.preventDefault();
    });
    window.addEventListener('mousemove', (ev) => {
      if (!dragging) return;
      STATE.hud.x = originX + (ev.clientX - startX);
      STATE.hud.y = originY + (ev.clientY - startY);
      applyHudPosition();
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      saveHudPrefs();
    });
  }

  function avatarForUser(userId) {
    const m = STATE.memberById[userId];
    if (m && m.avatarUrl) return m.avatarUrl;
    return null;
  }

  function toneForRating(rating) {
    if (rating == null) return 'mute';
    if (rating >= 4) return 'good';
    if (rating >= 3) return 'info';
    if (rating >= 2) return 'warn';
    return 'bad';
  }

  function starsFor(rating) {
    const full = clamp(Math.round(rating), 0, 5);
    return '\u2605'.repeat(full) + '\u2606'.repeat(5 - full);
  }

  function progressBar(label, done, total, tone) {
    const pct = total > 0 ? clamp((done / total) * 100, 0, 100) : 0;
    return `<div class="bb-hud-prog-label"><span>${escapeHtml(label)}</span><span>${done}/${total}</span></div>
      <div class="bb-hud-track"><i class="bb-fill-${tone}" style="width:${pct.toFixed(1)}%"></i></div>`;
  }

  function renderHud() {
    if (!hudEl) return;
    const room = STATE.room;
    const visible = !!room && !STATE.hud.hidden;
    hudEl.classList.toggle('bb-hud-on', visible);
    hudEl.classList.toggle('bb-collapsed', !!STATE.hud.collapsed);
    if (!visible) return;

    hudPhaseEl.textContent = `${room.phase || '?'} / ${room.gameState || '?'}`;
    if (STATE.hud.collapsed) return;

    const now = Date.now();
    const memberCount = (room.members || []).length;
    const uploaded = STATE.entries.filter((e) => e.hasUploaded);
    const expectedVotesPerTarget = Math.max(0, memberCount - 1);

    const metaBits = [`${room.name || '?'} [${room.code || '?'}]`];
    if (room.stageStartedAt && room.stageDurationSeconds) {
      const remaining = (new Date(room.stageStartedAt).getTime() + room.stageDurationSeconds * 1000 - now) / 1000;
      metaBits.push(`<span class="bb-hud-timer${remaining <= 30 ? ' bb-urgent' : ''}">${fmtClock(remaining)}</span>`);
    }
    hudMetaEl.innerHTML = escapeHtml(metaBits[0]) + (metaBits[1] ? ' &middot; ' + metaBits[1] : '');

    const castVotes = uploaded.reduce((sum, e) => sum + e.voteCount, 0);
    const possibleVotes = uploaded.length * expectedVotesPerTarget;
    const votingStarted = castVotes > 0 || room.gameState === 'voting';
    hudProgressEl.innerHTML = votingStarted
      ? progressBar('votes cast', castVotes, possibleVotes, castVotes >= possibleVotes && possibleVotes > 0 ? 'good' : 'info')
      : progressBar('uploads in', uploaded.length, memberCount, uploaded.length >= memberCount && memberCount > 0 ? 'good' : 'info');

    if (!STATE.entries.length) {
      hudRowsEl.innerHTML = '<div id="bb-hud-empty">waiting for players</div>';
      return;
    }

    const ranked = STATE.entries
      .slice()
      .sort((a, b) => {
        const av = a.expectedVotes ? a.score / a.expectedVotes : null;
        const bv = b.expectedVotes ? b.score / b.expectedVotes : null;
        if (av == null && bv == null) {
          if (a.hasUploaded !== b.hasUploaded) return a.hasUploaded ? -1 : 1;
          return a.displayName.localeCompare(b.displayName);
        }
        if (av == null) return 1;
        if (bv == null) return -1;
        if (bv !== av) return bv - av;
        return b.voteCount - a.voteCount;
      });

    hudRowsEl.innerHTML = ranked.map((e, i) => {
      const avg = formatAvgRating(e.score, e.expectedVotes);
      const rating = avg == null ? null : Number(avg);
      const tone = toneForRating(rating);
      const pct = rating == null ? 0 : clamp(((rating - 1) / 4) * 100, 0, 100);
      const avatarUrl = avatarForUser(e.userId);
      const flags = (e.forfeited ? ' <span class="bb-tone-bad">FF</span>' : '')
        + (e.dupeWith.length ? ' <span class="bb-tone-bad" title="duplicate upload">DUPE</span>' : '')
        + (e.left ? ' <span class="bb-tone-mute">left</span>' : '');
      const cls = 'bb-hud-row'
        + (rating != null && i === 0 ? ' bb-hud-top' : '')
        + (e.hasUploaded ? '' : ' bb-hud-pending');
      return `<div class="${cls}">
        <span class="bb-hud-rank">${i + 1}</span>
        ${avatarUrl
          ? `<img class="bb-hud-av" src="${escapeAttr(avatarUrl)}" alt="" loading="lazy" />`
          : '<span class="bb-hud-av"></span>'}
        <div class="bb-hud-main">
          <span class="bb-hud-name"${nameStyleAttr(e.nameColorKey)}>${escapeHtml(e.displayName)}${flags}</span>
          <span class="bb-hud-sub">
            <span class="bb-hud-track"><i class="bb-fill-${tone}" style="width:${pct.toFixed(1)}%"></i></span>
            <span class="bb-hud-votes">${e.voteCount}/${expectedVotesPerTarget}</span>
          </span>
        </div>
        <span class="bb-hud-val bb-tone-${tone}">${rating == null ? (e.hasUploaded ? '&ndash;' : '&middot;') : avg}<small>${rating == null ? '' : '/5'}</small></span>
      </div>`;
    }).join('');
  }

  const TOAST_MAX = 6;
  const TOAST_TTL_MS = 9000;
  const VOTE_TOAST_TTL_MS = 14000;
  const TOAST_MIN_VISIBLE_MS = 2500;
  const activeToasts = [];
  let toastTrimTimer = null;

  function trimToasts() {
    clearTimeout(toastTrimTimer);
    toastTrimTimer = null;
    const now = Date.now();
    while (activeToasts.length > TOAST_MAX) {
      const oldest = activeToasts[0];
      const age = now - oldest.shownAt;
      if (oldest.paused || age < TOAST_MIN_VISIBLE_MS) {
        toastTrimTimer = setTimeout(trimToasts, TOAST_MIN_VISIBLE_MS - age);
        return;
      }
      dismissToast(oldest);
    }
  }

  function toast(kind, title, body, opts) {
    const o = opts || {};
    if (kind && !STATE.toastToggles[kind]) return;
    if (STATE.ui.muted) return;
    ensureUI();
    if (!toastWrap) return;

    const key = o.key || `${kind}|${title}|${body || ''}`;
    const existing = activeToasts.find((t) => t.key === key);
    if (existing) {
      if (o.replace) {
        existing.el.className = 'bb-toast bb-tone-' + (o.tone || 'info');
        existing.el.innerHTML = toastInnerHtml(title, body, o);
        existing.count = 1;
        existing.el.classList.remove('bb-toast-bump');
        void existing.el.offsetWidth;
        existing.el.classList.add('bb-toast-bump');
      } else {
        existing.count += 1;
        const badge = existing.el.querySelector('.bb-toast-count');
        badge.textContent = '\u00d7' + existing.count;
        badge.hidden = false;
      }
      clearTimeout(existing.timer);
      existing.ttl = o.ttl || TOAST_TTL_MS;
      existing.expiresAt = Date.now() + existing.ttl;
      if (!existing.paused) existing.timer = setTimeout(() => dismissToast(existing), existing.ttl);
      return;
    }

    const el = document.createElement('div');
    el.className = 'bb-toast bb-tone-' + (o.tone || 'info');
    el.innerHTML = toastInnerHtml(title, body, o);
    const ttl = o.ttl || TOAST_TTL_MS;
    const entry = { el, key, count: 1, timer: null, shownAt: Date.now(), ttl, expiresAt: Date.now() + ttl, paused: false };
    el.addEventListener('click', () => dismissToast(entry));
    // Hovering holds a toast open, so a long one can actually be read.
    el.addEventListener('mouseenter', () => {
      entry.paused = true;
      clearTimeout(entry.timer);
    });
    el.addEventListener('mouseleave', () => {
      entry.paused = false;
      entry.expiresAt = Math.max(entry.expiresAt, Date.now() + 1200);
      entry.timer = setTimeout(() => dismissToast(entry), entry.expiresAt - Date.now());
    });
    toastWrap.appendChild(el);
    activeToasts.push(entry);
    trimToasts();
    entry.timer = setTimeout(() => dismissToast(entry), ttl);
  }

  function toastInnerHtml(title, body, o) {
    return `
      ${o.avatarUrl ? `<img class="bb-toast-av" src="${escapeAttr(o.avatarUrl)}" alt="" loading="lazy" />` : ''}
      <div class="bb-toast-text">
        <div class="bb-toast-title">${escapeHtml(title)}<span class="bb-toast-count" hidden></span></div>
        ${body ? `<div class="bb-toast-body">${o.bodyHtml ? body : escapeHtml(body)}</div>` : ''}
      </div>
    `;
  }

  function dismissToast(entry) {
    const i = activeToasts.indexOf(entry);
    if (i === -1) return;
    activeToasts.splice(i, 1);
    clearTimeout(entry.timer);
    if (activeToasts.length <= TOAST_MAX) {
      clearTimeout(toastTrimTimer);
      toastTrimTimer = null;
    }
    entry.el.classList.add('bb-toast-out');
    setTimeout(() => entry.el.remove(), 200);
  }

  function toastRatingVote(ev) {
    const rating = ratingFor(ev.score);
    const tone = toneForRating(rating);
    const changed = ev.prevScore != null;
    const was = changed ? `<span class="bb-tone-mute">${ratingFor(ev.prevScore)}/5 &rarr;</span> ` : '';
    toast('votes',
      `${nameFor(ev.voterId)} ${changed ? 're-rated' : 'rated'} ${nameFor(ev.targetId)}`,
      `<span class="bb-toast-stars bb-tone-${tone}">${starsFor(rating)}</span> ${was}${rating}/5`,
      {
        tone,
        bodyHtml: true,
        replace: true,
        ttl: VOTE_TOAST_TTL_MS,
        avatarUrl: avatarForUser(ev.voterId),
        key: `vote|${ev.voterId}|${ev.targetId}`,
      });
  }

  function toastRatingBatch(voterId, list) {
    const avgRating = list.reduce((sum, ev) => sum + ratingFor(ev.score), 0) / list.length;
    const shown = list.slice(0, 4).map((ev) => {
      const rating = ratingFor(ev.score);
      return `${escapeHtml(nameFor(ev.targetId))} <span class="bb-tone-${toneForRating(rating)}">${rating}/5</span>`;
    });
    const more = list.length > shown.length ? ` <span class="bb-tone-mute">+${list.length - shown.length} more</span>` : '';
    toast('votes', `${nameFor(voterId)} rated ${list.length} beats`,
      shown.join(' \u00b7 ') + more,
      {
        tone: toneForRating(avgRating),
        bodyHtml: true,
        replace: true,
        ttl: VOTE_TOAST_TTL_MS,
        avatarUrl: avatarForUser(voterId),
        key: `votebatch|${voterId}`,
      });
  }

  function toastUpload(entry) {
    playCue(660, 130);
    toast('uploads', `${entry.displayName} uploaded`, entry.fileName || 'a beat', {
      tone: 'good',
      avatarUrl: avatarForUser(entry.userId),
      key: `upload|${entry.userId}`,
    });
  }

  function toastKick(title, body, tone) {
    toast('kicks', title, body, { tone: tone || 'warn' });
  }

  function toastMember(kind, member) {
    toast(kind, `${member.displayName} ${kind === 'joins' ? 'joined' : 'left'}`, member.name || '', {
      tone: kind === 'joins' ? 'good' : 'mute',
      avatarUrl: member.avatarUrl || avatarForUser(member.userId),
      key: `${kind}|${member.userId}`,
    });
  }

  function fmtClock(totalSeconds) {
    if (totalSeconds == null) return null;
    const s = Math.max(0, Math.round(totalSeconds));
    const m = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, '0');
    return `${m}:${ss}`;
  }

  function nameFor(userId) {
    const m = STATE.memberById[userId];
    return (m && m.displayName) || userId;
  }

  function avatarForChatMsg(m) {
    if (m.avatarUrl) return m.avatarUrl;
    const member = STATE.memberById[m.userId];
    return (member && member.avatarUrl) || null;
  }

  function renderStatus() {
    ensureUI();
    renderHud();
    updateConnectionDot();
    const room = STATE.room;
    if (!room) {
      statusEl.innerHTML = '';
      if (headRoomEl) headRoomEl.textContent = 'no room';
      return;
    }
    injectNowPlayingCredit();
    const now = Date.now();
    if (headRoomEl) headRoomEl.textContent = room.code ? '#' + room.code : '';

    const lines = [];
    lines.push(`<div class="bb-room-line">
      <span class="bb-room-name">${escapeHtml(room.name || 'untitled room')}</span>
      <span class="bb-room-code">${escapeHtml(room.code || '?')}</span>
      <span class="bb-pill">${escapeHtml(room.phase || '?')} / ${escapeHtml(room.gameState || '?')}</span>
    </div>`);

    const facts = [
      ['players', `${room.memberCount != null ? room.memberCount : (room.members || []).length}/${room.maxPlayers || '?'}`],
      ['genre', room.genre || '?'],
      ['mode', `${room.matchMode || '?'} / ${room.gameplayMode || '?'}`],
      ['timer', room.timerMinutes != null ? room.timerMinutes + 'm' : '?'],
      ['host', (room.host && room.host.displayName) || '?'],
    ];
    if (room.visibility) facts.push(['visibility', room.visibility]);
    if (room.kitSeed != null) facts.push(['kit seed', String(room.kitSeed)]);
    lines.push(`<div class="bb-facts">${facts.map(([label, value]) =>
      `<span class="bb-fact">${escapeHtml(label)} <b>${escapeHtml(String(value))}</b></span>`).join('')}</div>`);

    if (room.creativeBrief) {
      lines.push(`<div class="bb-note bb-meta">brief: ${escapeHtml(room.creativeBrief)}</div>`);
    }
    if (room.sharedKit != null) {
      lines.push(`<div class="bb-note bb-meta">shared kit: ${escapeHtml(JSON.stringify(room.sharedKit).slice(0, 140))}</div>`);
    }

    if (room.stageStartedAt && room.stageDurationSeconds) {
      const remaining = (new Date(room.stageStartedAt).getTime() + room.stageDurationSeconds * 1000 - now) / 1000;
      lines.push(`<div class="bb-note">stage <span class="bb-timer${remaining <= 30 ? ' bb-urgent' : ''}">${fmtClock(remaining)}</span></div>`);
    }

    if (room.votingSkipRequestedUserIds && room.votingSkipRequestedUserIds.length) {
      lines.push(`<div class="bb-note bb-meta">skip requested by ${room.votingSkipRequestedUserIds.length}/${(room.members || []).length}</div>`);
    }

    if (room.gameState === 'showcase' && room.showcaseSchedule && room.showcaseSchedule.entries) {
      const cur = room.showcaseSchedule.entries.find(
        (en) => now >= en.playAtMs && now < en.playAtMs + en.durationMs
      );
      if (cur) {
        const remaining = (cur.playAtMs + cur.durationMs - now) / 1000;
        const skipVotes = (room.showcaseSkipVotesByEntryUserId || {})[cur.userId];
        const skipNote = skipVotes && skipVotes.length ? ` <span class="bb-meta">(${skipVotes.length} skip votes)</span>` : '';
        lines.push(`<div class="bb-note bb-playing">now playing <b>${escapeHtml(nameFor(cur.userId))}</b> <span class="bb-timer">${fmtClock(remaining)}</span>${skipNote}</div>`);
      } else {
        const next = room.showcaseSchedule.entries.find((en) => en.playAtMs > now);
        if (next) {
          const until = (next.playAtMs - now) / 1000;
          lines.push(`<div class="bb-note bb-playing">next up <b>${escapeHtml(nameFor(next.userId))}</b> in <span class="bb-timer">${fmtClock(until)}</span></div>`);
        }
      }
      checkNowPlaying(room, cur);
    }

    if (room.activeKickVote) {
      const kv = room.activeKickVote;
      const remaining = (new Date(kv.expiresAt).getTime() - now) / 1000;
      if (remaining > 0) {
        lines.push(`<div class="bb-note bb-kick">kick vote on <b>${escapeHtml(nameFor(kv.targetUserId))}</b> by ${escapeHtml(nameFor(kv.initiatedByUserId))} <span class="bb-timer">${fmtClock(remaining)}</span></div>`);
        lines.push(`<div class="bb-note bb-meta">${kv.voterUserIds.length} voted: ${escapeHtml(kv.voterUserIds.map(nameFor).join(', '))}</div>`);
      }
    }

    statusEl.innerHTML = lines.join('');
    renderMembers();
    renderResults();
    renderKickHistory();
  }

  function updateConnectionDot() {
    if (!toggleDotEl) return;
    const age = STATE.lastMsgAt ? Date.now() - STATE.lastMsgAt : Infinity;
    toggleDotEl.classList.toggle('bb-live', age < 20000);
    toggleDotEl.classList.toggle('bb-stale', age >= 20000 && age < 120000);
    toggleBtn.title = STATE.lastMsgAt
      ? 'last room update ' + timeAgo(STATE.lastMsgAt) + ' — alt+B'
      : 'waiting for the room socket — alt+B';
  }

  function wireCopyNames(root) {
    root.querySelectorAll('.bb-name[data-copy]').forEach((el) => {
      el.title = 'click to copy';
      el.addEventListener('click', () => copyText(el.dataset.copy, el));
    });
  }

  function checkNowPlaying(room, cur) {
    if (!cur) return;
    const revision = room.showcaseSchedule && room.showcaseSchedule.revision;
    if (STATE.notifiedNowPlaying.revision === revision && STATE.notifiedNowPlaying.userId === cur.userId) return;
    STATE.notifiedNowPlaying = { revision, userId: cur.userId };
    sendWebhookNowPlaying(room, cur);
  }

  function renderMembers() {
    const room = STATE.room;
    if (!room || !room.members || !room.members.length) {
      membersEl.innerHTML = '';
      return;
    }
    const kickCounts = room.kickInitiationCountByUserId || {};
    const forfeitedIds = new Set(room.forfeitedUserIds || []);
    const uploadedIds = new Set(STATE.entries.filter((e) => e.hasUploaded).map((e) => e.userId));
    const readyCount = room.members.filter((m) => m.isReady).length;

    const rows = room.members.map((m) => {
      const tags = [];
      if (uploadedIds.has(m.userId)) tags.push('<span class="bb-tone-good">uploaded</span>');
      if (forfeitedIds.has(m.userId)) tags.push('<span class="bb-tone-bad">forfeit</span>');
      const kicksInit = kickCounts[m.userId];
      if (kicksInit) tags.push(`<span class="bb-tone-warn">${kicksInit} kick${kicksInit === 1 ? '' : 's'}</span>`);
      return `<div class="bb-member-row">
        <span class="bb-ready-dot${m.isReady ? ' bb-is-ready' : ''}" title="${m.isReady ? 'ready' : 'not ready'}"></span>
        <span class="bb-name-cell"><span class="bb-name" data-copy="${escapeAttr(m.displayName)}"${nameStyleAttr(m.nameColorKey)}>${escapeHtml(m.displayName)}</span>${m.name ? ` <span class="bb-meta">${escapeHtml(m.name)}</span>` : ''}</span>
        <span class="bb-member-tags">${tags.join('')}</span>
      </div>`;
    }).join('');

    membersEl.innerHTML = `<div class="bb-section-title">Players <span class="bb-count">${readyCount}/${room.members.length} ready</span></div>${rows}`;
    wireCopyNames(membersEl);
  }

  function renderKickHistory() {
    const past = STATE.kickHistory.filter((h) => h.status !== 'pending');
    if (!past.length) {
      kickHistEl.innerHTML = '';
      return;
    }
    const rows = past
      .slice()
      .reverse()
      .map((h) => `<div class="bb-log-entry bb-log-kick">
        <span class="bb-tone-warn">${escapeHtml(h.targetName)}</span>
        <span class="bb-meta">${escapeHtml(h.status)}</span>
        <div class="bb-when">started by ${escapeHtml(h.initiatorName)} ${timeAgo(h.startedAt)} &middot; ${h.voterUserIds.length} voted</div>
        <div class="bb-meta">${escapeHtml(h.voterNames.join(', ') || 'no voters')}</div>
      </div>`)
      .join('');
    kickHistEl.innerHTML = `<div class="bb-section-title">Kick votes <span class="bb-count">${past.length}</span></div>${rows}`;
  }

  function renderChat() {
    ensureUI();
    const msgs = STATE.chatMessages;
    const titleEl = chatEl.querySelector('#bb-chat-title');
    const topEl = chatEl.querySelector('#bb-chat-top');
    titleEl.innerHTML = `Chat <span class="bb-count">${msgs.length}</span>`;

    if (!msgs.length) {
      topEl.innerHTML = '';
      chatLogEl.innerHTML = '<div class="bb-empty">no messages yet</div>';
      return;
    }

    const counts = {};
    msgs.forEach((m) => {
      counts[m.displayName || m.userId] = (counts[m.displayName || m.userId] || 0) + 1;
    });
    const top = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, n]) => `${name} (${n})`)
      .join(', ');
    topEl.textContent = `top chatters: ${top}`;

    const wasScrolledToBottom = chatLogEl.scrollTop + chatLogEl.clientHeight >= chatLogEl.scrollHeight - 4;
    chatLogEl.innerHTML = msgs
      .map((m) => {
        const t = new Date(m.createdAt).toLocaleTimeString();
        const avatarUrl = avatarForChatMsg(m);
        const avatarHtml = avatarUrl
          ? `<img class="bb-chat-avatar" src="${escapeAttr(avatarUrl)}" alt="" onerror="this.remove()" />`
          : '';
        return `<div class="bb-chat-row">
          ${avatarHtml}<span class="bb-chat-time">${t}</span>
          <span class="bb-chat-name"${nameStyleAttr(m.nameColorKey)}>${escapeHtml(m.displayName)}</span>: ${escapeHtml(m.text)}
        </div>`;
      })
      .join('');
    if (wasScrolledToBottom) chatLogEl.scrollTop = chatLogEl.scrollHeight;
  }

  function buildChatReportText() {
    const room = STATE.room;
    const lines = [];
    lines.push(`BeatBattle chat log${room ? ' - room ' + (room.code || room.id) : ''}`);
    lines.push(`total messages: ${STATE.chatMessages.length}`);
    lines.push('');
    STATE.chatMessages.forEach((m) => {
      const t = new Date(m.createdAt).toLocaleTimeString();
      lines.push(`[${t}] ${m.displayName}: ${m.text}`);
    });
    return lines.join('\n').trim();
  }

  function copyChatReport() {
    const text = buildChatReportText();
    const done = () => {
      chatCopyBtn.textContent = 'copied!';
      chatCopyBtn.classList.add('bb-copied');
      setTimeout(() => {
        chatCopyBtn.textContent = 'copy chat log';
        chatCopyBtn.classList.remove('bb-copied');
      }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  function renderPanel(flash) {
    ensureUI();
    const uploadedCount = STATE.entries.filter((e) => e.hasUploaded).length;
    if (toggleLabelEl) toggleLabelEl.textContent = `${uploadedCount}/${STATE.entries.length} uploads`;
    if (flash) {
      toggleBtn.classList.add('bb-flash');
      setTimeout(() => { toggleBtn.classList.remove('bb-flash'); }, 700);
    }
    renderStatus();
    renderJoinedMembers();
    renderLeftMembers();

    setBadge('uploads', STATE.entries.length ? `${uploadedCount}/${STATE.entries.length}` : null);
    setBadge('players', (STATE.room && (STATE.room.members || []).length) || null);
    setBadge('chat', STATE.chatMessages.length || null);
    setBadge('log', (STATE.joinedMembers.length + STATE.leftMembers.length) || null);

    const query = uiQuery.trim();
    const visible = sortEntries(STATE.entries.filter((e) => entryMatches(e, query)), STATE.ui.sort);
    const countLabel = query
      ? `${visible.length} of ${STATE.entries.length}`
      : `${uploadedCount}/${STATE.entries.length}`;
    listEl.innerHTML = `<div class="bb-section-title">Uploads <span class="bb-count">${countLabel}</span></div>`;

    if (!STATE.entries.length) {
      listEl.insertAdjacentHTML('beforeend', '<div class="bb-empty">no players yet</div>');
      return;
    }
    if (!visible.length) {
      listEl.insertAdjacentHTML('beforeend', `<div class="bb-empty">nothing matches ${escapeHtml(query)}</div>`);
      return;
    }

    const frag = document.createDocumentFragment();
    visible.forEach((e) => {
      const row = document.createElement('div');
      row.className = 'bb-entry' + (e.hasUploaded ? '' : ' bb-no-upload') + (e.left ? ' bb-left' : '');
      const tags = [];
      if (e.left) tags.push('<span class="bb-meta">left</span>');
      if (e.forfeited) tags.push('<span class="bb-tone-bad">forfeit</span>');
      const nameHtml = `<span class="bb-name" data-copy="${escapeAttr(e.displayName)}"${nameStyleAttr(e.nameColorKey)}>${escapeHtml(e.displayName)}</span>`;
      const whoHtml = `<div class="bb-who">${nameHtml}${e.name ? ` <span class="bb-meta">${escapeHtml(e.name)}</span>` : ''} ${tags.join(' ')}</div>`;

      if (!e.hasUploaded) {
        row.innerHTML = `${whoHtml}<div class="bb-fn bb-meta">no upload yet</div>`;
        frag.appendChild(row);
        return;
      }

      const sizeKb = e.byteSize ? Math.round(e.byteSize / 1024) : '?';
      const avgRating = formatAvgRating(e.score, e.expectedVotes);
      const rating = avgRating == null ? null : Number(avgRating);
      const scoreHtml = avgRating != null
        ? `<span class="bb-score${rating < 3 ? ' neg' : ''}">${avgRating}/5</span>
           <span class="bb-meta bb-tone-${toneForRating(rating)}">${starsFor(rating)}</span>
           <span class="bb-meta">${e.voteCount}/${e.expectedVotes} voted</span>`
        : '<span class="bb-meta">no votes yet</span>';
      const dupeHtml = e.dupeWith.length
        ? `<div class="bb-dupe">same sha256 as ${escapeHtml(e.dupeWith.join(', '))}</div>`
        : '';
      row.innerHTML = `
        ${whoHtml}
        <div class="bb-fn">${escapeHtml(e.fileName)}</div>
        <div class="bb-meta">${escapeHtml(e.mimeType || '?')} &middot; ${sizeKb} kb &middot; ${e.durationSeconds ? Math.round(e.durationSeconds) + 's' : '?'} &middot; ${e.downloadable ? 'downloadable' : 'stream only'}</div>
        <div>${scoreHtml}</div>
        ${dupeHtml}
        <div><a href="${escapeAttr(e.playbackUrl)}" target="_blank" rel="noopener noreferrer">open playback</a></div>
      `;
      frag.appendChild(row);
    });
    listEl.appendChild(frag);
    wireCopyNames(listEl);
  }

  function renderResults() {
    const room = STATE.room;
    const finished = room && (room.gameState === 'results' || room.results != null);
    if (!finished) {
      resultsEl.innerHTML = '';
      return;
    }
    const ranked = STATE.entries
      .filter((e) => e.hasUploaded)
      .slice()
      .sort((a, b) => (b.score || 0) - (a.score || 0));
    const rows = ranked
      .map((e, i) => {
        const avgRating = formatAvgRating(e.score, e.expectedVotes);
        const tone = toneForRating(avgRating == null ? null : Number(avgRating));
        return `<div class="bb-result-row${i === 0 ? ' bb-first' : ''}">
          <span class="bb-rank">${i + 1}</span>
          <span class="bb-result-name">${escapeHtml(e.displayName)} <span class="bb-meta">${escapeHtml(e.fileName)}</span></span>
          <span class="bb-result-score bb-tone-${tone}">${avgRating != null ? avgRating + '/5' : '—'}</span>
        </div>`;
      })
      .join('');
    const rematchIds = room.rematchRequestedUserIds || [];
    const rematchLine = rematchIds.length
      ? `<div class="bb-note bb-meta">rematch requested by ${rematchIds.length}/${(room.members || []).length}: ${escapeHtml(rematchIds.map(nameFor).join(', '))}</div>`
      : '';
    resultsEl.innerHTML = `<div class="bb-section-title">Final results <span class="bb-count">${ranked.length}</span></div>`
      + (rows || '<div class="bb-empty">no scored uploads</div>') + rematchLine;
  }

  function renderJoinedMembers() {
    if (!STATE.joinedMembers.length) {
      joinedMembersEl.innerHTML = '';
      return;
    }
    const rows = STATE.joinedMembers
      .slice()
      .reverse()
      .map((j) => {
        const tags = [];
        return `<div class="bb-log-entry bb-log-in">
          <span class="bb-tone-good">${escapeHtml(j.displayName)}</span>${j.name ? ` <span class="bb-meta">${escapeHtml(j.name)}</span>` : ''} ${tags.join(' ')}
          <div class="bb-when">joined ${timeAgo(j.joinedAt)} &middot; ${new Date(j.joinedAt).toLocaleTimeString()}</div>
        </div>`;
      })
      .join('');
    joinedMembersEl.innerHTML = `<div class="bb-section-title">Joined <span class="bb-count">${STATE.joinedMembers.length}</span></div>${rows}`;
  }

  function renderLeftMembers() {
    if (!STATE.leftMembers.length) {
      leftMembersEl.innerHTML = '';
      return;
    }
    const rows = STATE.leftMembers
      .slice()
      .reverse()
      .map((l) => {
        const tags = [];
        const uploadNote = l.upload
          ? `had uploaded ${escapeHtml(l.upload.fileName)}`
          : 'had not uploaded';
        return `<div class="bb-log-entry ${l.kicked ? 'bb-log-kick' : 'bb-log-out'}">
          <span class="bb-tone-bad">${escapeHtml(l.displayName)}</span>${l.name ? ` <span class="bb-meta">${escapeHtml(l.name)}</span>` : ''} ${tags.join(' ')}
          <div class="bb-when">${l.kicked ? 'kicked' : 'left'} ${timeAgo(l.leftAt)} &middot; ${escapeHtml(uploadNote)}</div>
        </div>`;
      })
      .join('');
    leftMembersEl.innerHTML = `<div class="bb-section-title">Left <span class="bb-count">${STATE.leftMembers.length}</span></div>${rows}`;
  }

  function buildReportText() {
    const room = STATE.room;
    const lines = [];
    lines.push(`BeatBattle report${room ? ' - room ' + (room.code || room.id) : ''}`);

    if (room) {
      lines.push('');
      lines.push('game info:');
      lines.push(`  name: ${room.name || '?'}`);
      lines.push(`  code: ${room.code || '?'}`);
      lines.push(`  genre: ${room.genre || '?'} / mode: ${room.matchMode || '?'} / gameplay: ${room.gameplayMode || '?'} / visibility: ${room.visibility || '?'}`);
      lines.push(`  players: ${room.memberCount != null ? room.memberCount : (room.members || []).length}/${room.maxPlayers || '?'}`);
      lines.push(`  timer: ${room.timerMinutes != null ? room.timerMinutes + 'm' : '?'}`);
      lines.push(`  host: ${(room.host && room.host.displayName) || '?'}`);
      lines.push(`  phase: ${room.phase || '?'} / ${room.gameState || '?'}`);
      if (room.kitSeed != null) lines.push(`  kit seed: ${room.kitSeed}`);
      if (room.sharedKit != null) lines.push(`  shared kit: ${JSON.stringify(room.sharedKit).slice(0, 200)}`);
      if (room.creativeBrief) lines.push(`  brief: ${room.creativeBrief}`);
    }

    if (room && room.members && room.members.length) {
      lines.push('');
      lines.push(`members (${room.members.length}):`);
      const kickCounts = room.kickInitiationCountByUserId || {};
      const forfeitedIds = new Set(room.forfeitedUserIds || []);
      room.members.forEach((m) => {
        const kicksInit = kickCounts[m.userId];
        const kickNote = kicksInit ? ` (started ${kicksInit} kick vote${kicksInit === 1 ? '' : 's'})` : '';
        const forfeitNote = forfeitedIds.has(m.userId) ? ' [forfeited]' : '';
        lines.push(`  - ${m.displayName}${m.name ? ' (' + m.name + ')' : ''} - ${m.isReady ? 'ready' : 'not ready'}${kickNote}${forfeitNote}`);
      });
    }

    const uploadedCount = STATE.entries.filter((e) => e.hasUploaded).length;
    lines.push('');
    lines.push(`uploads (${uploadedCount}/${STATE.entries.length}):`);
    lines.push('');

    STATE.entries.forEach((e, i) => {
      const leftNote = e.left ? ' [left room]' : '';
      const forfeitNote = e.forfeited ? ' [forfeited]' : '';

      if (!e.hasUploaded) {
        lines.push(`${i + 1}. (no upload yet)`);
        lines.push(`   Display name: ${e.displayName}${leftNote}${forfeitNote}`);
        lines.push(`   Username: ${e.name || '?'}`);
        lines.push('');
        return;
      }

      const sizeKb = e.byteSize ? Math.round(e.byteSize / 1024) : '?';
      const avgRating = formatAvgRating(e.score, e.expectedVotes);
      const score = avgRating != null ? `${avgRating}/5 (${e.voteCount} votes)` : 'no votes yet';
      const shaShort = e.sha256 ? e.sha256.slice(0, 6) : '?';
      lines.push(`${i + 1}. ${e.fileName}`);
      lines.push(`   Display name: ${e.displayName}${leftNote}${forfeitNote}`);
      lines.push(`   Username: ${e.name || '?'}`);
      lines.push(`   file: ${e.mimeType || '?'} · ${sizeKb}kb · ${e.durationSeconds ? Math.round(e.durationSeconds) + 's' : '?'} · ${e.downloadable ? 'downloadable' : 'stream-only'}`);
      lines.push(`   score: ${score}`);
      if (e.dupeWith.length) lines.push(`   dupe (same sha256) of: ${e.dupeWith.join(', ')}`);
      lines.push(`   sha256: ${shaShort}`);
      lines.push('');
    });

    const finished = room && (room.gameState === 'results' || room.results != null);
    if (finished) {
      const ranked = STATE.entries
        .filter((e) => e.hasUploaded)
        .slice()
        .sort((a, b) => (b.score || 0) - (a.score || 0));
      lines.push('final results:');
      ranked.forEach((e, i) => {
        const avgRating = formatAvgRating(e.score, e.expectedVotes);
        lines.push(`  #${i + 1} ${e.displayName} - ${e.fileName} - ${avgRating != null ? `${avgRating}/5` : 'no votes'} (${e.voteCount} votes)`);
      });
      const rematchIds = room.rematchRequestedUserIds || [];
      if (rematchIds.length) {
        lines.push(`  rematch requested (${rematchIds.length}/${(room.members || []).length}): ${rematchIds.map(nameFor).join(', ')}`);
      }
      lines.push('');
    }

    if (STATE.joinedMembers.length) {
      lines.push(`joined members (${STATE.joinedMembers.length}):`);
      STATE.joinedMembers
        .slice()
        .reverse()
        .forEach((j) => {
          lines.push(`  - ${j.displayName}${j.name ? ' (' + j.name + ')' : ''} - joined at ${new Date(j.joinedAt).toLocaleTimeString()}`);
        });
      lines.push('');
    }

    if (STATE.leftMembers.length) {
      lines.push(`left members (${STATE.leftMembers.length}):`);
      STATE.leftMembers
        .slice()
        .reverse()
        .forEach((l) => {
          const uploadNote = l.upload ? `had uploaded: ${l.upload.fileName}` : 'had not uploaded';
          lines.push(`  - ${l.displayName}${l.name ? ' (' + l.name + ')' : ''} - ${l.kicked ? 'kicked' : 'left'} at ${new Date(l.leftAt).toLocaleTimeString()} - ${uploadNote}`);
        });
      lines.push('');
    }

    const kickPast = STATE.kickHistory.filter((h) => h.status !== 'pending');
    if (STATE.room && STATE.room.activeKickVote || kickPast.length) {
      lines.push('kick votes:');
      if (STATE.room && STATE.room.activeKickVote) {
        const kv = STATE.room.activeKickVote;
        lines.push(`  [ongoing] ${nameFor(kv.targetUserId)}, started by ${nameFor(kv.initiatedByUserId)}`);
        lines.push(`    voters (${kv.voterUserIds.length}): ${kv.voterUserIds.map(nameFor).join(', ') || 'none'}`);
      }
      kickPast
        .slice()
        .reverse()
        .forEach((h) => {
          lines.push(`  [${h.status}] ${h.targetName}, started by ${h.initiatorName} at ${new Date(h.startedAt).toLocaleTimeString()}`);
          lines.push(`    voters (${h.voterUserIds.length}): ${h.voterNames.join(', ') || 'none'}`);
        });
      lines.push('');
    }

    lines.push(`chat: ${STATE.chatMessages.length} message(s) - use "copy chat log" for full transcript`);

    return lines.join('\n').trim();
  }

  function copyReport() {
    const text = buildReportText();
    const done = () => {
      copyBtn.textContent = 'copied!';
      copyBtn.classList.add('bb-copied');
      setTimeout(() => {
        copyBtn.textContent = 'copy all as text';
        copyBtn.classList.remove('bb-copied');
      }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.documentElement.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      done();
    } catch (e) {
      console.error('[BB overlay] copy failed', e);
    }
    ta.remove();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) {
    return escapeHtml(s);
  }

  function chatSlugFromHref(href) {
    const m = /\/profile\/([^/?#]+)/.exec(href || '');
    return m ? decodeURIComponent(m[1]) : null;
  }

  function avatarForSlug(slug) {
    if (!slug) return null;
    const target = slug.toLowerCase();
    const matches = (m) => m && ((m.name && m.name.toLowerCase() === target) || (m.displayName && m.displayName.toLowerCase() === target));
    const pools = [Object.values(STATE.memberById), STATE.leftMembers, STATE.joinedMembers];
    for (const pool of pools) {
      const found = pool.find(matches);
      if (found && found.avatarUrl) return found.avatarUrl;
    }
    const chatMatch = STATE.chatMessages.find(matches);
    return chatMatch ? avatarForChatMsg(chatMatch) : null;
  }

  function isChatMessageAnchor(a) {
    if (a.querySelector('img')) return false;
    const row = a.parentElement;
    if (!row) return false;

    return !!row.querySelector(':scope > span[class*="flex-1"]');
  }

  function injectSiteChatAvatars() {
    const anchors = document.querySelectorAll('a[href^="/profile/"]:not([data-bb-avatar-injected])');
    anchors.forEach((a) => {
      if (!isChatMessageAnchor(a)) return;
      const slug = chatSlugFromHref(a.getAttribute('href'));
      const avatarUrl = avatarForSlug(slug);
      if (!avatarUrl) return;
      a.setAttribute('data-bb-avatar-injected', '1');
      const img = document.createElement('img');
      img.src = avatarUrl;
      img.alt = '';
      img.style.cssText = 'width:18px;height:18px;border-radius:50%;object-fit:cover;flex-shrink:0;align-self:center;margin-right:2px;';
      img.onerror = () => img.remove();
      a.parentElement.insertBefore(img, a);
    });
  }

  function findEntryHeadings() {
    return Array.from(document.querySelectorAll('h2')).filter((h) => /^Entry\s+\d+$/i.test(h.textContent.trim()));
  }

  function injectNowPlayingCredit() {
    const room = STATE.room;
    const schedule = room && room.showcaseSchedule;
    findEntryHeadings().forEach((h2) => {
      const match = /^Entry\s+(\d+)$/i.exec(h2.textContent.trim());
      if (!match) return;
      const entryNum = parseInt(match[1], 10);
      const scheduleEntry = schedule && schedule.entries && schedule.entries[entryNum - 1];

      let credit = h2.parentElement && h2.parentElement.querySelector(':scope > .bb-entry-credit');
      if (!scheduleEntry) {
        if (credit) credit.remove();
        return;
      }

      const uploadEntry = STATE.entries.find((e) => e.userId === scheduleEntry.userId);
      const displayName = (uploadEntry && uploadEntry.displayName) || nameFor(scheduleEntry.userId);
      const fileName = uploadEntry && uploadEntry.fileName;
      const text = fileName ? `${displayName} - ${fileName}` : displayName;

      if (!credit) {
        credit = document.createElement('p');
        credit.className = 'bb-entry-credit font-sans';
        credit.style.cssText = 'margin-top:8px;font-size:0.85rem;color:var(--bb-muted,#9a9ca8);text-align:center;';
        h2.insertAdjacentElement('afterend', credit);
      }
      if (credit.dataset.bbEntry !== String(entryNum) || credit.textContent !== text) {
        credit.textContent = text;
        credit.dataset.bbEntry = String(entryNum);
      }
    });
  }

  function startSiteDomInjectors() {
    injectSiteChatAvatars();
    injectNowPlayingCredit();
    const observer = new MutationObserver(() => {
      injectSiteChatAvatars();
      injectNowPlayingCredit();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener('DOMContentLoaded', startSiteDomInjectors);
  if (document.readyState !== 'loading') startSiteDomInjectors();

  document.addEventListener('DOMContentLoaded', ensureUI);
  if (document.readyState !== 'loading') ensureUI();
})();
