// ==UserScript==
// @name         BeatBattleX
// @namespace    beatbattlex
// @version      1.0.0
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
    notifiedRatingVotes: [],
    notifiedRatingVotesRoomId: null,
    notifiedRatingVotesNeedsSeed: false,
    notifiedRatingVoteSet: new Set(),
    toastToggles: { votes: true, kicks: true, uploads: true, joins: false, left: false, results: true },
    hud: { hidden: false, collapsed: false, x: null, y: null },
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
  const LS_NOTIFIED_RATING_PREFIX = 'bb-notified-rating-votes-';
  const LS_TOAST_TOGGLES_KEY = 'bb-toast-toggles';
  const LS_HUD_KEY = 'bb-hud-prefs';

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
        score: scoreEntry ? scoreEntry.sum : null,
        voteCount: scoreEntry ? scoreEntry.count : 0,
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
      toast('results', `winner: ${winner.displayName}`, `${formatAvgRating(winner.score, winner.voteCount) || '?'}/5 from ${winner.voteCount} vote${winner.voteCount === 1 ? '' : 's'}`, {
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

  function formatAvgRating(score, voteCount) {
    if (score == null || !voteCount) return null;
    return (score / voteCount + 3).toFixed(1);
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
      const avgRating = formatAvgRating(e.score, e.voteCount);
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

  function sendWebhookRatingVote(room, voterId, vote) {
    if (!STATE.webhookUrl || !STATE.webhookToggles.votes) return;
    const targetEntry = STATE.entries.find((e) => e.userId === vote.targetId);
    postWebhook(STATE.webhookUrl, {
      username: 'BeatBattleX',
      embeds: [{
        title: `${nameFor(voterId)} rated ${nameFor(vote.targetId)}'s beat`,
        fields: [
          { name: 'Voter', value: nameFor(voterId), inline: true },
          { name: 'Target', value: nameFor(vote.targetId), inline: true },
          { name: 'Rating', value: `${ratingFor(vote.score)}/5`, inline: true },
          { name: 'File', value: (targetEntry && targetEntry.fileName) || '?', inline: false },
        ],
        color: 0x7fffb0,
      }],
    });
  }

  function detectRatingVotes(room) {
    if (STATE.notifiedRatingVotesRoomId !== room.id) {
      let raw = null;
      try {
        raw = localStorage.getItem(LS_NOTIFIED_RATING_PREFIX + room.id);
      } catch (e) {}
      STATE.notifiedRatingVotesNeedsSeed = raw === null;
      STATE.notifiedRatingVotes = loadFromLS(LS_NOTIFIED_RATING_PREFIX, room.id);
      STATE.notifiedRatingVoteSet = new Set(STATE.notifiedRatingVotes);
      STATE.notifiedRatingVotesRoomId = room.id;
    }

    const votesByUserId = room.votesByUserId || {};
    const allKeys = [];
    Object.keys(votesByUserId).forEach((voterId) => {
      (votesByUserId[voterId] || []).forEach((v) => {
        allKeys.push(voterId + '|' + v.targetId);
      });
    });

    if (STATE.notifiedRatingVotesNeedsSeed) {
      STATE.notifiedRatingVotes = allKeys.slice();
      STATE.notifiedRatingVoteSet = new Set(allKeys);
      STATE.notifiedRatingVotesNeedsSeed = false;
      saveToLS(LS_NOTIFIED_RATING_PREFIX, room.id, STATE.notifiedRatingVotes);
      return;
    }

    const fresh = [];
    Object.keys(votesByUserId).forEach((voterId) => {
      (votesByUserId[voterId] || []).forEach((v) => {
        const key = voterId + '|' + v.targetId;
        if (STATE.notifiedRatingVoteSet.has(key)) return;
        STATE.notifiedRatingVoteSet.add(key);
        STATE.notifiedRatingVotes.push(key);
        fresh.push({ voterId, vote: v });
      });
    });
    if (!fresh.length) return;

    saveToLS(LS_NOTIFIED_RATING_PREFIX, room.id, STATE.notifiedRatingVotes);
    fresh.forEach(({ voterId, vote }) => {
      toastRatingVote(voterId, vote);
      sendWebhookRatingVote(room, voterId, vote);
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

  function ensureUI() {
    if (toggleBtn) return;

    const style = document.createElement('style');
    style.textContent = `
      :root {
        --bb2-bg: #111116;
        --bb2-surface: #18181f;
        --bb2-surface-hover: #1e1e26;
        --bb2-border: rgba(255,255,255,0.08);
        --bb2-border-strong: rgba(255,255,255,0.16);
        --bb2-ink: #e6e6ec;
        --bb2-muted: #a3a3ae;
        --bb2-muted-soft: #75757f;
        --bb2-accent: #a3a3dd;
        --bb2-accent-soft: #cfcfef;
        --bb2-positive: #86d6a8;
        --bb2-positive-bg: rgba(134,214,168,0.14);
        --bb2-negative: #e0918f;
        --bb2-negative-bg: rgba(224,145,143,0.14);
        --bb2-warning: #ddc088;
        --bb2-info: #8fc0e0;
        --bb2-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif;
      }
      #bb-overlay-toggle {
        position: fixed; bottom: 8px; right: 8px; z-index: 999999;
        background: var(--bb2-surface);
        color: var(--bb2-ink); border: 1px solid var(--bb2-border-strong);
        border-radius: 8px; padding: 7px 13px;
        font: 500 13.5px/1 var(--bb2-font);
        cursor: pointer; opacity: 0.92; user-select: none;
        box-shadow: 0 2px 10px rgba(0,0,0,.35);
        transition: opacity .15s, transform .1s, background .3s;
      }
      #bb-overlay-toggle:hover { opacity: 1; transform: translateY(-1px); background: var(--bb2-surface-hover); }
      #bb-overlay-toggle:active { transform: translateY(0); }
      #bb-overlay-toggle.bb-flash { background: var(--bb2-positive-bg); border-color: var(--bb2-positive); color: var(--bb2-positive); }
      #bb-overlay-panel {
        position: fixed; bottom: 46px; right: 8px; z-index: 999999;
        width: 380px; max-height: 72vh; overflow-y: auto;
        background: var(--bb2-bg); color: var(--bb2-ink);
        border: 1px solid var(--bb2-border-strong); border-bottom: 2px solid var(--bb2-accent);
        border-radius: 12px; padding: 14px;
        font: 400 13.5px/1.55 var(--bb2-font);
        display: none; box-shadow: 0 12px 32px rgba(0,0,0,.45);
      }
      #bb-overlay-panel.open { display: block; }
      #bb-overlay-panel::-webkit-scrollbar { width: 9px; }
      #bb-overlay-panel::-webkit-scrollbar-thumb { background: var(--bb2-border-strong); border-radius: 5px; }
      #bb-overlay-panel .bb-section-title {
        font-size: 11.5px; font-weight: 600; letter-spacing: .3px;
        color: var(--bb2-muted-soft); margin: 2px 0 6px;
      }
      #bb-overlay-panel .bb-entry {
        border-bottom: 1px solid var(--bb2-border); padding: 8px 6px; word-break: break-word;
        border-radius: 6px; transition: background .12s;
      }
      #bb-overlay-panel .bb-entry:hover { background: var(--bb2-surface); }
      #bb-overlay-panel .bb-entry:last-child { border-bottom: none; }
      #bb-overlay-panel .bb-fn { color: var(--bb2-info); font-weight: 600; }
      #bb-overlay-panel .bb-who { color: var(--bb2-ink); }
      #bb-overlay-panel .bb-meta { color: var(--bb2-muted); }
      #bb-overlay-panel a { color: var(--bb2-positive); text-decoration: none; }
      #bb-overlay-panel a:hover { text-decoration: underline; }
      #bb-overlay-panel .bb-empty { color: var(--bb2-muted-soft); font-style: italic; }
      #bb-overlay-panel .bb-score { color: var(--bb2-positive); }
      #bb-overlay-panel .bb-score.neg { color: var(--bb2-negative); }
      #bb-overlay-panel .bb-dupe { color: var(--bb2-negative); font-weight: 600; }
      #bb-status {
        border-bottom: 1px solid var(--bb2-border); padding-bottom: 9px; margin-bottom: 9px;
        color: var(--bb2-muted);
      }
      #bb-status .bb-status-line { margin: 3px 0; }
      #bb-status .bb-phase { color: var(--bb2-info); }
      #bb-status .bb-timer { color: var(--bb2-warning); }
      #bb-status .bb-playing { color: var(--bb2-positive); }
      #bb-status .bb-kick { color: var(--bb2-negative); }
      #bb-kick-history {
        border-bottom: 1px solid var(--bb2-border); padding-bottom: 9px; margin-bottom: 9px;
      }
      #bb-kick-history:empty { border: none; margin: 0; padding: 0; }
      #bb-kick-history .bb-kick-hist-entry {
        margin: 5px 0; padding: 6px 8px; border-top: none;
        background: var(--bb2-surface); border-radius: 6px;
      }
      #bb-members {
        border-bottom: 1px solid var(--bb2-border); padding-bottom: 9px; margin-bottom: 9px;
      }
      #bb-members .bb-member-row { margin: 3px 0; }
      #bb-members .bb-ready { color: var(--bb2-positive); }
      #bb-members .bb-not-ready { color: var(--bb2-muted-soft); }
      #bb-results {
        border-bottom: 1px solid var(--bb2-border); padding-bottom: 9px; margin-bottom: 9px;
      }
      #bb-results:empty { border: none; margin: 0; padding: 0; }
      #bb-results .bb-result-row { margin: 4px 0; }
      #bb-results .bb-rank { color: var(--bb2-positive); font-weight: 600; }
      #bb-joined-members {
        border-bottom: 1px solid var(--bb2-border); padding-bottom: 9px; margin-bottom: 9px;
      }
      #bb-joined-members:empty { border: none; margin: 0; padding: 0; }
      #bb-left-members {
        border-bottom: 1px solid var(--bb2-border); padding-bottom: 9px; margin-bottom: 9px;
      }
      #bb-left-members:empty { border: none; margin: 0; padding: 0; }
      #bb-overlay-panel .bb-entry.bb-no-upload { opacity: 0.6; }
      #bb-overlay-panel .bb-entry.bb-left { border-left: 2px solid var(--bb2-border-strong); padding-left: 8px; }
      #bb-chat {
        border-bottom: 1px solid var(--bb2-border); padding-bottom: 9px; margin-bottom: 9px;
      }
      #bb-chat-log {
        max-height: 160px; overflow-y: auto; background: var(--bb2-surface);
        border-radius: 6px; padding: 6px 8px;
      }
      #bb-chat-log .bb-chat-row { margin: 3px 0; word-break: break-word; }
      #bb-chat-log .bb-chat-time { color: var(--bb2-muted-soft); }
      #bb-chat-log .bb-chat-name { color: var(--bb2-ink); font-weight: 600; }
      #bb-chat-log .bb-chat-avatar {
        width: 14px; height: 14px; border-radius: 50%;
        vertical-align: middle; margin-right: 4px; object-fit: cover;
      }
      #bb-chat-top { color: var(--bb2-muted-soft); margin-bottom: 6px; }
      #bb-webhook-wrap {
        border-bottom: 1px solid var(--bb2-border); padding-bottom: 9px; margin-bottom: 9px;
      }
      #bb-webhook-input {
        display: block; width: 100%; box-sizing: border-box; margin-bottom: 7px;
        background: var(--bb2-surface); color: var(--bb2-ink); border: 1px solid var(--bb2-border-strong);
        border-radius: 6px; padding: 6px 8px; font: 12px var(--bb2-font);
      }
      #bb-webhook-input:focus { outline: none; border-color: var(--bb2-accent); }
      .bb-toggle-grid {
        display: flex; flex-wrap: wrap; gap: 6px 12px; margin-bottom: 7px; color: var(--bb2-muted);
      }
      .bb-toggle-grid .bb-webhook-toggle {
        display: inline-flex; align-items: center; gap: 4px; cursor: pointer; font-size: 11px;
      }
      #bb-copy-btn, #bb-chat-copy-btn, #bb-webhook-save-btn, #bb-hud-show-btn {
        display: block; width: 100%; margin-bottom: 8px;
        background: var(--bb2-surface);
        color: var(--bb2-ink); border: 1px solid var(--bb2-border-strong);
        border-radius: 6px; padding: 7px; font: 500 12px var(--bb2-font);
        cursor: pointer; text-align: center; transition: background .15s;
      }
      #bb-copy-btn:hover, #bb-chat-copy-btn:hover, #bb-webhook-save-btn:hover, #bb-hud-show-btn:hover { background: var(--bb2-surface-hover); }
      #bb-copy-btn.bb-copied, #bb-chat-copy-btn.bb-copied, #bb-webhook-save-btn.bb-copied {
        background: var(--bb2-positive-bg); color: var(--bb2-positive); border-color: var(--bb2-positive);
      }
      #bb-credits {
        margin-top: 8px; padding-top: 9px; border-top: 1px solid var(--bb2-border);
        color: var(--bb2-muted-soft); font-size: 10.5px; text-align: center; line-height: 1.6;
      }
      #bb-credits a { color: var(--bb2-accent); }
      #bb-credits a:hover { text-decoration: underline; }
      #bb-credits .bb-discord-cta {
        display: inline-block; margin-top: 6px; padding: 5px 10px;
        border: 1px solid var(--bb2-border-strong); border-radius: 6px;
        color: var(--bb2-accent-soft); font-size: 11px; font-weight: 600;
        transition: background .15s, border-color .15s;
      }
      #bb-credits .bb-discord-cta:hover { background: var(--bb2-surface-hover); border-color: var(--bb2-accent); text-decoration: none; }

      #bb-hud {
        position: fixed; top: 8px; right: 8px; z-index: 999998;
        width: 268px; background: var(--bb2-bg); color: var(--bb2-ink);
        border: 1px solid var(--bb2-border-strong); border-top: 2px solid var(--bb2-accent);
        border-radius: 10px; overflow: hidden;
        font: 400 12.5px/1.45 var(--bb2-font);
        box-shadow: 0 10px 28px rgba(0,0,0,.45);
        display: none;
      }
      #bb-hud.bb-hud-on { display: block; }
      #bb-hud-head {
        display: flex; align-items: center; gap: 6px;
        padding: 7px 8px; background: var(--bb2-surface);
        border-bottom: 1px solid var(--bb2-border); cursor: grab; user-select: none;
      }
      #bb-hud-head:active { cursor: grabbing; }
      #bb-hud-title { font-weight: 600; font-size: 11.5px; letter-spacing: .4px; text-transform: uppercase; color: var(--bb2-accent-soft); }
      #bb-hud-phase {
        margin-left: auto; font-size: 10px; color: var(--bb2-muted);
        border: 1px solid var(--bb2-border); border-radius: 20px; padding: 1px 7px; white-space: nowrap;
      }
      #bb-hud-head button {
        background: none; border: none; color: var(--bb2-muted-soft);
        cursor: pointer; font: 600 13px/1 var(--bb2-font); padding: 2px 3px; border-radius: 4px;
      }
      #bb-hud-head button:hover { color: var(--bb2-ink); background: var(--bb2-surface-hover); }
      #bb-hud.bb-collapsed #bb-hud-body { display: none; }
      #bb-hud-body { padding: 8px; }
      #bb-hud-meta { color: var(--bb2-muted); font-size: 11px; margin-bottom: 6px; word-break: break-word; }
      #bb-hud-meta .bb-hud-timer { color: var(--bb2-warning); font-variant-numeric: tabular-nums; }
      #bb-hud-progress { margin-bottom: 7px; }
      #bb-hud-progress .bb-hud-prog-label {
        display: flex; justify-content: space-between; font-size: 10.5px; color: var(--bb2-muted-soft); margin-bottom: 3px;
      }
      .bb-hud-track { height: 4px; border-radius: 3px; background: var(--bb2-surface-hover); overflow: hidden; }
      .bb-hud-track > i { display: block; height: 100%; border-radius: 3px; background: var(--bb2-accent); transition: width .35s ease; }
      #bb-hud-rows { display: flex; flex-direction: column; gap: 5px; }
      .bb-hud-row {
        display: grid; grid-template-columns: 16px 20px 1fr auto; gap: 6px;
        align-items: center; padding: 3px 4px; border-radius: 6px; transition: background .12s;
      }
      .bb-hud-row:hover { background: var(--bb2-surface); }
      .bb-hud-row.bb-hud-me { background: var(--bb2-surface); }
      .bb-hud-rank { color: var(--bb2-muted-soft); font-size: 10.5px; text-align: right; font-variant-numeric: tabular-nums; }
      .bb-hud-row.bb-hud-top .bb-hud-rank { color: var(--bb2-warning); font-weight: 700; }
      .bb-hud-av { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; background: var(--bb2-surface-hover); }
      .bb-hud-main { min-width: 0; }
      .bb-hud-name { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12px; }
      .bb-hud-sub { display: flex; align-items: center; gap: 5px; margin-top: 2px; }
      .bb-hud-sub .bb-hud-track { flex: 1; }
      .bb-hud-votes { font-size: 9.5px; color: var(--bb2-muted-soft); font-variant-numeric: tabular-nums; white-space: nowrap; }
      .bb-hud-val { font-weight: 700; font-size: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .bb-hud-val small { font-weight: 400; font-size: 9.5px; color: var(--bb2-muted-soft); }
      .bb-tone-good { color: var(--bb2-positive); } .bb-fill-good { background: var(--bb2-positive) !important; }
      .bb-tone-info { color: var(--bb2-info); }     .bb-fill-info { background: var(--bb2-info) !important; }
      .bb-tone-warn { color: var(--bb2-warning); }  .bb-fill-warn { background: var(--bb2-warning) !important; }
      .bb-tone-bad  { color: var(--bb2-negative); } .bb-fill-bad  { background: var(--bb2-negative) !important; }
      .bb-tone-mute { color: var(--bb2-muted-soft); }
      #bb-hud-rows .bb-hud-pending { opacity: .55; }
      #bb-hud-foot {
        margin-top: 8px; padding-top: 7px; border-top: 1px solid var(--bb2-border);
        display: flex; align-items: center; justify-content: space-between; font-size: 10px; color: var(--bb2-muted-soft);
      }
      #bb-hud-foot a { color: var(--bb2-accent); text-decoration: none; }
      #bb-hud-foot a:hover { text-decoration: underline; }
      #bb-hud-empty { color: var(--bb2-muted-soft); font-style: italic; font-size: 11.5px; }

      #bb-toasts {
        position: fixed; bottom: 8px; left: 8px; z-index: 1000000;
        display: flex; flex-direction: column-reverse; gap: 7px;
        max-width: 292px; pointer-events: none;
      }
      .bb-toast {
        display: flex; gap: 8px; align-items: flex-start;
        background: var(--bb2-surface); color: var(--bb2-ink);
        border: 1px solid var(--bb2-border-strong); border-left: 3px solid var(--bb2-accent);
        border-radius: 8px; padding: 8px 10px;
        font: 400 12px/1.4 var(--bb2-font);
        box-shadow: 0 6px 20px rgba(0,0,0,.45);
        cursor: pointer; pointer-events: auto;
        animation: bb-toast-in .22s ease-out;
      }
      .bb-toast:hover { background: var(--bb2-surface-hover); }
      .bb-toast.bb-toast-out { animation: bb-toast-out .18s ease-in forwards; }
      .bb-toast.bb-tone-good { border-left-color: var(--bb2-positive); }
      .bb-toast.bb-tone-info { border-left-color: var(--bb2-info); }
      .bb-toast.bb-tone-warn { border-left-color: var(--bb2-warning); }
      .bb-toast.bb-tone-bad  { border-left-color: var(--bb2-negative); }
      .bb-toast-av { width: 26px; height: 26px; border-radius: 50%; object-fit: cover; flex: none; background: var(--bb2-bg); }
      .bb-toast-text { min-width: 0; }
      .bb-toast-title { font-weight: 600; word-break: break-word; }
      .bb-toast-body { color: var(--bb2-muted); font-size: 11px; word-break: break-word; }
      .bb-toast-stars { letter-spacing: 1px; }
      .bb-toast-count {
        margin-left: 6px; font-size: 10px; color: var(--bb2-muted-soft);
        border: 1px solid var(--bb2-border); border-radius: 10px; padding: 0 5px;
      }
      @keyframes bb-toast-in { from { opacity: 0; transform: translateX(-14px) scale(.97); } to { opacity: 1; transform: none; } }
      @keyframes bb-toast-out { to { opacity: 0; transform: translateX(-14px); } }
      @media (prefers-reduced-motion: reduce) {
        .bb-toast, .bb-toast.bb-toast-out { animation: none; }
        .bb-hud-track > i { transition: none; }
      }
    `;
    document.documentElement.appendChild(style);

    toggleBtn = document.createElement('div');
    toggleBtn.id = 'bb-overlay-toggle';
    toggleBtn.textContent = 'uploads (0)';
    toggleBtn.addEventListener('click', () => {
      panel.classList.toggle('open');
    });

    panel = document.createElement('div');
    panel.id = 'bb-overlay-panel';

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
      webhookSaveBtn.textContent = 'saved!';
      webhookSaveBtn.classList.add('bb-copied');
      setTimeout(() => {
        webhookSaveBtn.textContent = 'save webhook';
        webhookSaveBtn.classList.remove('bb-copied');
      }, 1200);
    });
    webhookWrap.appendChild(webhookSaveBtn);
    panel.appendChild(webhookWrap);

    const toastWrapUI = document.createElement('div');
    toastWrapUI.id = 'bb-toast-wrap';
    toastWrapUI.style.cssText = 'border-bottom:1px solid var(--bb2-border);padding-bottom:9px;margin-bottom:9px;';
    const toastDefs = [
      ['votes', 'ratings'], ['kicks', 'kick votes'], ['uploads', 'uploads'],
      ['joins', 'joins'], ['left', 'leaves'], ['results', 'results'],
    ];
    toastWrapUI.innerHTML = `
      <div class="bb-section-title">On-screen toasts</div>
      <div class="bb-toggle-grid">
        ${toastDefs.map(([key, label]) => `
          <label class="bb-webhook-toggle">
            <input type="checkbox" data-toast-key="${key}" ${STATE.toastToggles[key] ? 'checked' : ''} />
            ${escapeHtml(label)}
          </label>
        `).join('')}
      </div>
    `;
    toastWrapUI.querySelectorAll('input[data-toast-key]').forEach((cb) => {
      cb.addEventListener('change', () => {
        STATE.toastToggles[cb.dataset.toastKey] = cb.checked;
        setToastToggles(STATE.toastToggles);
      });
    });
    hudShowBtn = document.createElement('button');
    hudShowBtn.id = 'bb-hud-show-btn';
    hudShowBtn.textContent = STATE.hud.hidden ? 'show score HUD' : 'hide score HUD';
    hudShowBtn.addEventListener('click', () => toggleHud());
    toastWrapUI.appendChild(hudShowBtn);
    panel.appendChild(toastWrapUI);

    copyBtn = document.createElement('button');
    copyBtn.id = 'bb-copy-btn';
    copyBtn.textContent = 'copy all as text';
    copyBtn.addEventListener('click', copyReport);
    panel.appendChild(copyBtn);

    statusEl = document.createElement('div');
    statusEl.id = 'bb-status';
    panel.appendChild(statusEl);

    membersEl = document.createElement('div');
    membersEl.id = 'bb-members';
    panel.appendChild(membersEl);

    resultsEl = document.createElement('div');
    resultsEl.id = 'bb-results';
    panel.appendChild(resultsEl);

    joinedMembersEl = document.createElement('div');
    joinedMembersEl.id = 'bb-joined-members';
    panel.appendChild(joinedMembersEl);

    leftMembersEl = document.createElement('div');
    leftMembersEl.id = 'bb-left-members';
    panel.appendChild(leftMembersEl);

    kickHistEl = document.createElement('div');
    kickHistEl.id = 'bb-kick-history';
    panel.appendChild(kickHistEl);

    listEl = document.createElement('div');
    panel.appendChild(listEl);

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
    chatCopyBtn.style.marginTop = '6px';
    chatCopyBtn.addEventListener('click', copyChatReport);
    chatEl.appendChild(chatCopyBtn);
    chatLogEl = chatEl.querySelector('#bb-chat-log');
    panel.appendChild(chatEl);

    const credits = document.createElement('div');
    credits.id = 'bb-credits';
    credits.innerHTML = `made by @alshailopezstein96 on Discord`
      + `<br><a href="https://github.com/FaithfullyOSS/BeatBattleX" target="_blank" rel="noopener noreferrer">github.com/FaithfullyOSS/BeatBattleX</a>`
      + `<br><a class="bb-discord-cta" href="${DISCORD_INVITE}" target="_blank" rel="noopener noreferrer">join our Discord</a>`;
    panel.appendChild(credits);

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
      if (!ev.altKey || ev.ctrlKey || ev.metaKey) return;
      const t = ev.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
      const key = (ev.key || '').toLowerCase();
      if (key === 'b') { panel.classList.toggle('open'); ev.preventDefault(); }
      else if (key === 'h') { toggleHud(); ev.preventDefault(); }
      else if (key === 'c') {
        STATE.hud.collapsed = !STATE.hud.collapsed;
        saveHudPrefs();
        renderHud();
        ev.preventDefault();
      }
    });

    setInterval(() => {
      if (STATE.room) renderStatus();
    }, 1000);
  }

  function toggleHud(forceHide) {
    STATE.hud.hidden = forceHide === true ? true : !STATE.hud.hidden;
    saveHudPrefs();
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
    if (hudShowBtn) hudShowBtn.textContent = STATE.hud.hidden ? 'show score HUD' : 'hide score HUD';
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
      metaBits.push(`<span class="bb-hud-timer">${fmtClock(remaining)}</span>`);
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
        const av = a.voteCount ? a.score / a.voteCount : null;
        const bv = b.voteCount ? b.score / b.voteCount : null;
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
      const avg = formatAvgRating(e.score, e.voteCount);
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

  const TOAST_MAX = 5;
  const TOAST_TTL_MS = 6000;
  const activeToasts = [];

  function toast(kind, title, body, opts) {
    const o = opts || {};
    if (kind && !STATE.toastToggles[kind]) return;
    ensureUI();
    if (!toastWrap) return;

    const key = o.key || `${kind}|${title}|${body || ''}`;
    const existing = activeToasts.find((t) => t.key === key);
    if (existing) {
      existing.count += 1;
      const badge = existing.el.querySelector('.bb-toast-count');
      badge.textContent = '\u00d7' + existing.count;
      badge.hidden = false;
      clearTimeout(existing.timer);
      existing.timer = setTimeout(() => dismissToast(existing), o.ttl || TOAST_TTL_MS);
      return;
    }

    const el = document.createElement('div');
    el.className = 'bb-toast bb-tone-' + (o.tone || 'info');
    el.innerHTML = `
      ${o.avatarUrl ? `<img class="bb-toast-av" src="${escapeAttr(o.avatarUrl)}" alt="" loading="lazy" />` : ''}
      <div class="bb-toast-text">
        <div class="bb-toast-title">${escapeHtml(title)}<span class="bb-toast-count" hidden></span></div>
        ${body ? `<div class="bb-toast-body">${o.bodyHtml ? body : escapeHtml(body)}</div>` : ''}
      </div>
    `;
    const entry = { el, key, count: 1, timer: null };
    el.addEventListener('click', () => dismissToast(entry));
    toastWrap.appendChild(el);
    activeToasts.push(entry);
    while (activeToasts.length > TOAST_MAX) dismissToast(activeToasts[0]);
    entry.timer = setTimeout(() => dismissToast(entry), o.ttl || TOAST_TTL_MS);
  }

  function dismissToast(entry) {
    const i = activeToasts.indexOf(entry);
    if (i === -1) return;
    activeToasts.splice(i, 1);
    clearTimeout(entry.timer);
    entry.el.classList.add('bb-toast-out');
    setTimeout(() => entry.el.remove(), 200);
  }

  function toastRatingVote(voterId, vote) {
    const rating = ratingFor(vote.score);
    const tone = toneForRating(rating);
    toast('votes', `${nameFor(voterId)} rated ${nameFor(vote.targetId)}`,
      `<span class="bb-toast-stars bb-tone-${tone}">${starsFor(rating)}</span> ${rating}/5`,
      {
        tone,
        bodyHtml: true,
        avatarUrl: avatarForUser(voterId),
        key: `vote|${voterId}|${vote.targetId}`,
      });
  }

  function toastUpload(entry) {
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
    const room = STATE.room;
    if (!room) {
      statusEl.innerHTML = '';
      return;
    }
    injectNowPlayingCredit();
    const now = Date.now();
    const lines = [];

    lines.push('<div class="bb-section-title">Game info</div>');
    lines.push(`<div class="bb-status-line">${escapeHtml(room.name || '?')} [${escapeHtml(room.code || '?')}]</div>`);
    lines.push(`<div class="bb-status-line bb-meta">${escapeHtml(room.genre || '?')} · ${escapeHtml(room.matchMode || '?')} · ${escapeHtml(room.gameplayMode || '?')} · ${escapeHtml(room.visibility || '?')}</div>`);
    lines.push(`<div class="bb-status-line bb-meta">players: ${room.memberCount != null ? room.memberCount : (room.members || []).length}/${room.maxPlayers || '?'} · timer: ${room.timerMinutes != null ? room.timerMinutes + 'm' : '?'} · host: ${escapeHtml((room.host && room.host.displayName) || '?')}</div>`);
    if (room.kitSeed != null) {
      lines.push(`<div class="bb-status-line bb-meta">kit seed: ${escapeHtml(String(room.kitSeed))}</div>`);
    }
    if (room.sharedKit != null) {
      lines.push(`<div class="bb-status-line bb-meta">shared kit: ${escapeHtml(JSON.stringify(room.sharedKit).slice(0, 200))}</div>`);
    }
    if (room.creativeBrief) {
      lines.push(`<div class="bb-status-line bb-meta">brief: ${escapeHtml(room.creativeBrief)}</div>`);
    }

    lines.push('<div class="bb-section-title">Status</div>');
    lines.push(`<div class="bb-status-line bb-phase">phase: ${escapeHtml(room.phase || '?')} / ${escapeHtml(room.gameState || '?')}</div>`);

    if (room.votingSkipRequestedUserIds && room.votingSkipRequestedUserIds.length) {
      const total = (room.members || []).length;
      lines.push(`<div class="bb-status-line bb-meta">skip vote requested: ${room.votingSkipRequestedUserIds.length}/${total}</div>`);
    }

    if (room.stageStartedAt && room.stageDurationSeconds) {
      const remaining = (new Date(room.stageStartedAt).getTime() + room.stageDurationSeconds * 1000 - now) / 1000;
      lines.push(`<div class="bb-status-line bb-timer">stage timer: ${fmtClock(remaining)}</div>`);
    }

    if (room.gameState === 'showcase' && room.showcaseSchedule && room.showcaseSchedule.entries) {
      const cur = room.showcaseSchedule.entries.find(
        (en) => now >= en.playAtMs && now < en.playAtMs + en.durationMs
      );
      if (cur) {
        const remaining = (cur.playAtMs + cur.durationMs - now) / 1000;
        const skipVotes = (room.showcaseSkipVotesByEntryUserId || {})[cur.userId];
        const skipNote = skipVotes && skipVotes.length ? ` (skip votes: ${skipVotes.length})` : '';
        lines.push(`<div class="bb-status-line bb-playing">now playing: ${escapeHtml(nameFor(cur.userId))} (${fmtClock(remaining)} left)${skipNote}</div>`);
      } else {
        const next = room.showcaseSchedule.entries.find((en) => en.playAtMs > now);
        if (next) {
          const until = (next.playAtMs - now) / 1000;
          lines.push(`<div class="bb-status-line bb-playing">next up: ${escapeHtml(nameFor(next.userId))} in ${fmtClock(until)}</div>`);
        }
      }
      checkNowPlaying(room, cur);
    }

    if (room.activeKickVote) {
      const kv = room.activeKickVote;
      const remaining = (new Date(kv.expiresAt).getTime() - now) / 1000;
      if (remaining > 0) {
        const voters = kv.voterUserIds.map(nameFor).join(', ');
        lines.push(`<div class="bb-status-line bb-kick">kick vote: ${escapeHtml(nameFor(kv.targetUserId))}, started by ${escapeHtml(nameFor(kv.initiatedByUserId))}, ${fmtClock(remaining)} left</div>`);
        lines.push(`<div class="bb-status-line bb-kick">voters (${kv.voterUserIds.length}): ${escapeHtml(voters)}</div>`);
      }
    }

    statusEl.innerHTML = lines.join('');
    renderMembers();
    renderResults();
    renderKickHistory();
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
    const rows = room.members
      .map((m) => {
        const kicksInit = kickCounts[m.userId];
        const kickNote = kicksInit ? ` <span class="bb-meta">(started ${kicksInit} kick vote${kicksInit === 1 ? '' : 's'})</span>` : '';
        const forfeitNote = forfeitedIds.has(m.userId) ? ' <span class="bb-dupe">[forfeited]</span>' : '';
        return `<div class="bb-member-row">
          <span class="${m.isReady ? 'bb-ready' : 'bb-not-ready'}">${m.isReady ? 'ready' : 'not ready'}</span>
          <span${nameStyleAttr(m.nameColorKey)}>${escapeHtml(m.displayName)}</span>${m.name ? ' (' + escapeHtml(m.name) + ')' : ''}${kickNote}${forfeitNote}
        </div>`;
      })
      .join('');
    membersEl.innerHTML = `<div class="bb-section-title">Members (${room.members.length})</div>${rows}`;
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
      .map((h) => {
        const t = new Date(h.startedAt).toLocaleTimeString();
        return `<div class="bb-kick-hist-entry">
          <span class="bb-kick">${escapeHtml(h.targetName)}</span> [${escapeHtml(h.status)}]
          started by ${escapeHtml(h.initiatorName)} at ${t}
          <div class="bb-meta">voters (${h.voterUserIds.length}): ${escapeHtml(h.voterNames.join(', ') || 'none')}</div>
        </div>`;
      })
      .join('');
    kickHistEl.innerHTML = `<div class="bb-section-title">Kick history (${past.length})</div>${rows}`;
  }

  function renderChat() {
    ensureUI();
    const msgs = STATE.chatMessages;
    const titleEl = chatEl.querySelector('#bb-chat-title');
    const topEl = chatEl.querySelector('#bb-chat-top');
    titleEl.textContent = `Chat (${msgs.length})`;

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
    toggleBtn.textContent = `uploads (${uploadedCount}/${STATE.entries.length})`;
    if (flash) {
      toggleBtn.classList.add('bb-flash');
      setTimeout(() => { toggleBtn.classList.remove('bb-flash'); }, 600);
    }
    renderStatus();
    renderJoinedMembers();
    renderLeftMembers();
    listEl.innerHTML = '<div class="bb-section-title">Uploads</div>';

    if (!STATE.entries.length) {
      listEl.insertAdjacentHTML('beforeend', '<div class="bb-empty">no members yet</div>');
      return;
    }

    const frag = document.createDocumentFragment();
    STATE.entries.forEach((e) => {
      const row = document.createElement('div');
      row.className = 'bb-entry' + (e.hasUploaded ? '' : ' bb-no-upload') + (e.left ? ' bb-left' : '');
      const leftTag = e.left ? ' <span class="bb-meta">[left room]</span>' : '';
      const forfeitTag = e.forfeited ? ' <span class="bb-dupe">[forfeited]</span>' : '';
      const nameHtml = `<span${nameStyleAttr(e.nameColorKey)}>${escapeHtml(e.displayName)}</span>`;

      if (!e.hasUploaded) {
        row.innerHTML = `
          <div class="bb-fn bb-meta">no upload yet</div>
          <div class="bb-who">${nameHtml}${e.name ? ' (' + escapeHtml(e.name) + ')' : ''}${leftTag}${forfeitTag}</div>
        `;
        frag.appendChild(row);
        return;
      }

      const sizeKb = e.byteSize ? Math.round(e.byteSize / 1024) : '?';
      const avgRating = formatAvgRating(e.score, e.voteCount);
      const scoreHtml = avgRating != null
        ? `<span class="bb-score${Number(avgRating) < 3 ? ' neg' : ''}">${avgRating}/5 (${e.voteCount} vote${e.voteCount === 1 ? '' : 's'})</span>`
        : '<span class="bb-meta">no votes yet</span>';
      const dupeHtml = e.dupeWith.length
        ? `<div class="bb-dupe">dupe (same sha256) of: ${escapeHtml(e.dupeWith.join(', '))}</div>`
        : '';
      row.innerHTML = `
        <div class="bb-fn">${escapeHtml(e.fileName)}</div>
        <div class="bb-who">${nameHtml}${e.name ? ' (' + escapeHtml(e.name) + ')' : ''}${leftTag}${forfeitTag}</div>
        <div class="bb-meta">${escapeHtml(e.mimeType || '')} · ${sizeKb}kb · ${e.durationSeconds ? Math.round(e.durationSeconds) + 's' : '?'} · ${e.downloadable ? 'downloadable' : 'stream-only'}</div>
        <div>${scoreHtml}</div>
        ${dupeHtml}
        <div><a href="${escapeAttr(e.playbackUrl)}" target="_blank" rel="noopener noreferrer">playback</a></div>
      `;
      frag.appendChild(row);
    });
    listEl.appendChild(frag);
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
        const avgRating = formatAvgRating(e.score, e.voteCount);
        return `<div class="bb-result-row"><span class="bb-rank">#${i + 1}</span> ${escapeHtml(e.displayName)} - ${escapeHtml(e.fileName)} - ${avgRating != null ? `${avgRating}/5` : 'no votes'} (${e.voteCount} votes)</div>`;
      })
      .join('');
    const rematchIds = room.rematchRequestedUserIds || [];
    const rematchLine = rematchIds.length
      ? `<div class="bb-status-line bb-meta">rematch requested (${rematchIds.length}/${(room.members || []).length}): ${escapeHtml(rematchIds.map(nameFor).join(', '))}</div>`
      : '';
    resultsEl.innerHTML = `<div class="bb-section-title">Final results</div>${rows || '<div class="bb-empty">no scored uploads</div>'}${rematchLine}`;
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
        return `<div class="bb-kick-hist-entry">
          <span class="bb-ready">${escapeHtml(j.displayName)}</span>${j.name ? ' (' + escapeHtml(j.name) + ')' : ''}
          <div class="bb-meta">joined at ${new Date(j.joinedAt).toLocaleTimeString()}</div>
        </div>`;
      })
      .join('');
    joinedMembersEl.innerHTML = `<div class="bb-section-title">Joined members (${STATE.joinedMembers.length})</div>${rows}`;
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
        const uploadNote = l.upload
          ? `<div class="bb-meta">had uploaded: ${escapeHtml(l.upload.fileName)}</div>`
          : '<div class="bb-meta">had not uploaded</div>';
        return `<div class="bb-kick-hist-entry">
          <span class="bb-kick">${escapeHtml(l.displayName)}</span>${l.name ? ' (' + escapeHtml(l.name) + ')' : ''}
          <div class="bb-meta">${l.kicked ? 'kicked' : 'left'} at ${new Date(l.leftAt).toLocaleTimeString()}</div>
          ${uploadNote}
        </div>`;
      })
      .join('');
    leftMembersEl.innerHTML = `<div class="bb-section-title">Left members (${STATE.leftMembers.length})</div>${rows}`;
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
      const avgRating = formatAvgRating(e.score, e.voteCount);
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
        const avgRating = formatAvgRating(e.score, e.voteCount);
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
