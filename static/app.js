/**
 * RAG Document AI Assistant - Interactive Client Application
 * Pure Vanilla JavaScript with Real-time SSE Streaming & Lucide Icons Support
 */

document.addEventListener('DOMContentLoaded', () => {
  // Lucide Icons Helper
  function refreshIcons() {
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  // Initial Lucide Icons Render
  refreshIcons();

  // State Management
  const state = {
    sessions: [], // Array of { id, title, createdAt, updatedAt, messages: [] }
    currentSessionId: null,
    messages: [], // Array of { role: 'user' | 'bot', content: string, sources?: [], timestamp?: string }
    isGenerating: false,
    abortController: null,
    soundEnabled: true,
    topK: 4,
    systemInfo: null,
    activeSources: []
  };

  // DOM Elements
  const chatMessages = document.getElementById('chatMessages');
  const welcomeHero = document.getElementById('welcomeHero');
  const chatForm = document.getElementById('chatForm');
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const stopBtn = document.getElementById('stopGenerationBtn');
  const searchIndicator = document.getElementById('searchIndicator');
  const searchIndicatorText = document.getElementById('searchIndicatorText');
  const scrollBottomBtn = document.getElementById('scrollBottomBtn');

  // Sidebar Elements
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebarOverlay');
  const openSidebarBtn = document.getElementById('openSidebarBtn');
  const closeSidebarBtn = document.getElementById('closeSidebarBtn');
  const newChatBtn = document.getElementById('newChatBtn');
  const clearChatBtn = document.getElementById('clearChatBtn');
  const exportChatBtn = document.getElementById('exportChatBtn');
  const reindexBtn = document.getElementById('reindexBtn');
  const sessionList = document.getElementById('sessionList');
  const sessionCountBadge = document.getElementById('sessionCountBadge');
  const documentList = document.getElementById('documentList');
  const docCountBadge = document.getElementById('docCountBadge');

  // Modal Elements
  const docModal = document.getElementById('docModal');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const modalTitle = document.getElementById('modalTitle');
  const modalMeta = document.getElementById('modalMeta');
  const modalContent = document.getElementById('modalContent');
  const toastContainer = document.getElementById('toastContainer');

  // Markdown Parser Setup
  const md = window.markdownit ? window.markdownit({
    html: false,
    linkify: true,
    typographer: true,
    breaks: true
  }) : null;

  // Simple Web Audio API Synthesizer
  const audioContext = window.AudioContext ? new (window.AudioContext || window.webkitAudioContext)() : null;

  function playTone(freq, type = 'sine', duration = 0.08) {
    if (!state.soundEnabled || !audioContext) return;
    try {
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioContext.currentTime);
      gain.gain.setValueAtTime(0.05, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + duration);
    } catch (e) {
      // Audio not permitted or failed
    }
  }

  function playSendSound() {
    playTone(520, 'sine', 0.06);
    setTimeout(() => playTone(680, 'sine', 0.08), 50);
  }

  function playReceiveSound() {
    playTone(600, 'sine', 0.06);
    setTimeout(() => playTone(780, 'sine', 0.1), 70);
  }

  // Toast Notification Helper
  function showToast(message, type = 'info', duration = 3500) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const iconName = type === 'success' ? 'check-circle' : type === 'error' ? 'alert-triangle' : 'info';
    toast.innerHTML = `
      <i data-lucide="${iconName}"></i>
      <span>${escapeHtml(message)}</span>
    `;
    toastContainer.appendChild(toast);
    refreshIcons();

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px) scale(0.95)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // HTML Escape Helper
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.innerText = text;
    return div.innerHTML;
  }

  // Render Markdown Safely
  function renderMarkdown(text) {
    if (md) {
      return md.render(text || '');
    }
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  // LocalStorage Session Management
  const STORAGE_KEY = 'rag_ai_chat_sessions';

  function loadSessionsFromStorage() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Gagal membaca sesi:', e);
      return [];
    }
  }

  function saveSessionsToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.sessions));
    } catch (e) {
      console.error('Gagal menyimpan sesi:', e);
    }
  }

  function formatRelativeTime(timestamp) {
    if (!timestamp) return '';
    const diffMs = Date.now() - timestamp;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Baru saja';
    if (diffMin < 60) return `${diffMin}m lalu`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}j lalu`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay === 1) return 'Kemarin';
    if (diffDay < 7) return `${diffDay}h lalu`;
    return new Date(timestamp).toLocaleDateString([], { day: 'numeric', month: 'short' });
  }

  function renderSessionList() {
    if (!sessionList) return;
    sessionList.innerHTML = '';
    if (sessionCountBadge) {
      sessionCountBadge.textContent = state.sessions.length;
    }

    if (state.sessions.length === 0) {
      sessionList.innerHTML = `
        <div class="empty-session-state">
          <i data-lucide="message-square-dashed"></i>
          <span>Belum ada riwayat chat</span>
        </div>
      `;
      refreshIcons();
      return;
    }

    state.sessions.forEach(session => {
      const item = document.createElement('div');
      item.className = `session-item ${session.id === state.currentSessionId ? 'active' : ''}`;
      item.dataset.sessionId = session.id;

      item.innerHTML = `
        <div class="session-info">
          <i data-lucide="message-square" class="session-icon"></i>
          <div class="session-text-group">
            <span class="session-title" title="${escapeHtml(session.title)}">${escapeHtml(session.title)}</span>
            <span class="session-time">${formatRelativeTime(session.updatedAt || session.createdAt)}</span>
          </div>
        </div>
        <button class="session-delete-btn" title="Hapus riwayat ini" data-session-id="${session.id}">
          <i data-lucide="trash-2"></i>
        </button>
      `;

      item.addEventListener('click', (e) => {
        if (e.target.closest('.session-delete-btn')) return;
        if (session.id === state.currentSessionId) return;
        if (state.isGenerating) {
          showToast('Harap tunggu atau hentikan respon sebelum berpindah chat.', 'info');
          return;
        }
        loadSession(session.id);
        closeSidebarMobile();
      });

      const deleteBtn = item.querySelector('.session-delete-btn');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSession(session.id);
      });

      sessionList.appendChild(item);
    });

    refreshIcons();
  }

  function loadSession(sessionId) {
    const session = state.sessions.find(s => s.id === sessionId);
    if (!session) return;

    state.currentSessionId = session.id;
    state.messages = [...(session.messages || [])];

    chatMessages.innerHTML = '';
    if (state.messages.length === 0) {
      if (welcomeHero) {
        welcomeHero.classList.remove('hidden');
        chatMessages.appendChild(welcomeHero);
      }
    } else {
      if (welcomeHero) {
        welcomeHero.classList.add('hidden');
      }
      renderMessagesFromHistory(state.messages);
    }

    renderSessionList();
    scrollToBottom(true);
  }

  function renderMessagesFromHistory(messages) {
    messages.forEach(msg => {
      if (msg.role === 'user') {
        const row = document.createElement('div');
        row.className = 'message-row user';
        row.innerHTML = `
          <div class="message-avatar" title="Anda">
            <i data-lucide="user"></i>
          </div>
          <div class="message-body">
            <div class="message-bubble">${escapeHtml(msg.content)}</div>
          </div>
        `;
        chatMessages.appendChild(row);
      } else if (msg.role === 'bot') {
        const row = document.createElement('div');
        row.className = 'message-row bot';
        const timestamp = msg.timestamp || '';
        row.innerHTML = `
          <div class="message-avatar" title="RAG Gemini Assistant">
            <i data-lucide="cpu"></i>
          </div>
          <div class="message-body">
            <div class="message-bubble">
              <div class="bubble-content">${renderMarkdown(msg.content)}</div>
            </div>
            <div class="sources-placeholder"></div>
            <div class="message-actions">
              <button class="action-btn copy-btn" title="Salin Jawaban">
                <i data-lucide="copy"></i>
                <span>Salin</span>
              </button>
              ${timestamp ? `<span class="message-timestamp">${escapeHtml(timestamp)}</span>` : ''}
            </div>
          </div>
        `;
        chatMessages.appendChild(row);

        const sourcesPlaceholder = row.querySelector('.sources-placeholder');
        if (msg.sources && msg.sources.length > 0) {
          renderSourcesAccordion(sourcesPlaceholder, msg.sources);
        }

        const copyBtn = row.querySelector('.copy-btn');
        if (copyBtn) {
          setupCopyButton(copyBtn, msg.content);
        }
      }
    });

    refreshIcons();
  }

  function deleteSession(sessionId) {
    const idx = state.sessions.findIndex(s => s.id === sessionId);
    if (idx === -1) return;

    state.sessions.splice(idx, 1);
    saveSessionsToStorage();

    if (state.currentSessionId === sessionId) {
      startNewSession(false);
    } else {
      renderSessionList();
    }

    showToast('Riwayat percakapan dihapus.', 'info');
  }

  function startNewSession(showNotice = true) {
    if (state.isGenerating) {
      showToast('Harap tunggu atau hentikan respon sebelum memulai chat baru.', 'info');
      return;
    }

    state.currentSessionId = null;
    state.messages = [];
    chatMessages.innerHTML = '';
    if (welcomeHero) {
      welcomeHero.classList.remove('hidden');
      chatMessages.appendChild(welcomeHero);
    }

    renderSessionList();
    if (showNotice) {
      showToast('Percakapan baru telah dimulai.', 'success');
    }
    closeSidebarMobile();
  }

  // Fetch Status and Document List
  async function fetchStatus() {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error('Gagal mengambil status');
      const data = await res.json();
      state.systemInfo = data;

      if (docCountBadge) docCountBadge.textContent = (data.documents && data.documents.length) || '0';
      const modelBadge = document.getElementById('headerModelBadge');
      if (modelBadge && data.llm_model) {
        modelBadge.textContent = `v1.0 • ${data.llm_model}`;
      }
      renderDocuments(data.documents || []);
    } catch (err) {
      console.warn('Status fetch warning:', err);
    }
  }

  // Render Document List in Sidebar
  function renderDocuments(docs) {
    if (!docs || docs.length === 0) {
      documentList.innerHTML = `
        <div style="font-size:0.75rem; color:var(--text-dim); text-align:center; padding:12px 0;">
          Belum ada dokumen PDF terdeteksi di folder documents/.
        </div>
      `;
      return;
    }

    documentList.innerHTML = docs.map(doc => `
      <div class="doc-item" title="${escapeHtml(doc.filename)}">
        <div class="doc-name">
          <i data-lucide="file-text"></i>
          <span>${escapeHtml(doc.filename)}</span>
        </div>
        <div class="doc-meta">
          <span><i data-lucide="book-open"></i> ${doc.total_halaman} Halaman</span>
          <span>•</span>
          <span><i data-lucide="hard-drive"></i> ${doc.size_mb} MB</span>
        </div>
      </div>
    `).join('');

    refreshIcons();
  }

  // Reindex Documents
  async function handleReindex() {
    if (state.isGenerating) return;
    reindexBtn.disabled = true;
    reindexBtn.innerHTML = `
      <i data-lucide="loader-2" class="rotating"></i>
      <span>Mengindeks PDF...</span>
    `;
    refreshIcons();
    showToast('Memulai proses indeks ulang dokumen PDF...', 'info');

    try {
      const res = await fetch('/api/reindex', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(`Berhasil mengindeks ${data.result.total_chunks} potongan dokumen!`, 'success');
        await fetchStatus();
      } else {
        showToast('Gagal melakukan indeks dokumen.', 'error');
      }
    } catch (err) {
      showToast('Koneksi terputus saat re-indeks.', 'error');
    } finally {
      reindexBtn.disabled = false;
      reindexBtn.innerHTML = `
        <i data-lucide="refresh-cw"></i>
        <span>Indeks Ulang PDF</span>
      `;
      refreshIcons();
    }
  }

  // Textarea Auto-Resize & Submit Handling
  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + 'px';
    sendBtn.disabled = !messageInput.value.trim() || state.isGenerating;
  });

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled && !state.isGenerating) {
        chatForm.dispatchEvent(new Event('submit'));
      }
    }
  });

  // Suggestion Chips Click
  document.querySelectorAll('.suggestion-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = chip.getAttribute('data-prompt');
      if (prompt) {
        messageInput.value = prompt;
        messageInput.dispatchEvent(new Event('input'));
        chatForm.dispatchEvent(new Event('submit'));
      }
    });
  });

  // Scroll Detection
  chatMessages.addEventListener('scroll', () => {
    const isNearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 120;
    if (isNearBottom) {
      scrollBottomBtn.classList.add('hidden');
    } else {
      scrollBottomBtn.classList.remove('hidden');
    }
  });

  scrollBottomBtn.addEventListener('click', () => {
    chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
  });

  function scrollToBottom(force = false) {
    if (force) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    } else {
      const isNearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 140;
      if (isNearBottom) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    }
  }

  // Create User Message Bubble
  function appendUserMessage(text) {
    if (welcomeHero) {
      welcomeHero.classList.add('hidden');
    }

    const row = document.createElement('div');
    row.className = 'message-row user';
    row.innerHTML = `
      <div class="message-avatar" title="Anda">
        <i data-lucide="user"></i>
      </div>
      <div class="message-body">
        <div class="message-bubble">${escapeHtml(text)}</div>
      </div>
    `;
    chatMessages.appendChild(row);
    refreshIcons();
    scrollToBottom(true);
    state.messages.push({ role: 'user', content: text });
  }

  // Create Bot Message Row (for streaming)
  function createBotMessageRow() {
    if (welcomeHero) {
      welcomeHero.classList.add('hidden');
    }

    const row = document.createElement('div');
    row.className = 'message-row bot';

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    row.innerHTML = `
      <div class="message-avatar" title="RAG Gemini Assistant">
        <i data-lucide="cpu"></i>
      </div>
      <div class="message-body">
        <div class="message-bubble">
          <div class="bubble-content"></div>
          <span class="cursor-typing"></span>
        </div>
        
        <!-- Sources Container Placeholder -->
        <div class="sources-placeholder"></div>

        <!-- Action Bar -->
        <div class="message-actions hidden">
          <button class="action-btn copy-btn" title="Salin Jawaban">
            <i data-lucide="copy"></i>
            <span>Salin</span>
          </button>
          <span class="message-timestamp">${timestamp}</span>
        </div>
      </div>
    `;

    chatMessages.appendChild(row);
    refreshIcons();
    scrollToBottom(true);

    const bubbleContent = row.querySelector('.bubble-content');
    const cursor = row.querySelector('.cursor-typing');
    const sourcesPlaceholder = row.querySelector('.sources-placeholder');
    const actionsBar = row.querySelector('.message-actions');
    const copyBtn = row.querySelector('.copy-btn');

    return { row, bubbleContent, cursor, sourcesPlaceholder, actionsBar, copyBtn };
  }

  // Render Sources Accordion
  function renderSourcesAccordion(container, sources) {
    if (!sources || sources.length === 0) return;

    state.activeSources = sources;

    const accordion = document.createElement('div');
    accordion.className = 'sources-container';

    accordion.innerHTML = `
      <div class="sources-header">
        <div class="sources-title">
          <i data-lucide="book-open"></i>
          <span>${sources.length} Referensi Dokumen Ditemukan</span>
        </div>
        <i data-lucide="chevron-down" class="sources-toggle-icon"></i>
      </div>
      <div class="sources-body">
        ${sources.map((s, idx) => `
          <div class="source-item" data-source-index="${idx}">
            <div class="source-header-row">
              <span class="source-title-text">
                <i data-lucide="file-text"></i>
                ${escapeHtml(s.sumber)}
              </span>
              <div class="source-badges">
                <span class="badge-page">Hal. ${s.halaman}</span>
                <span class="badge-score">${s.persen_kemiripan || (s.skor * 100).toFixed(0)}% Relevan</span>
              </div>
            </div>
            <div class="source-snippet">${escapeHtml(s.teks)}</div>
          </div>
        `).join('')}
      </div>
    `;

    container.appendChild(accordion);
    refreshIcons();

    // Toggle expand/collapse
    const header = accordion.querySelector('.sources-header');
    header.addEventListener('click', () => {
      accordion.classList.toggle('expanded');
    });

    // Item click opens modal preview
    accordion.querySelectorAll('.source-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(item.getAttribute('data-source-index'), 10);
        openDocumentModal(sources[index]);
      });
    });
  }

  // Open Document Modal Preview
  function openDocumentModal(source) {
    if (!source) return;
    modalTitle.textContent = source.sumber;
    modalMeta.innerHTML = `
      <span class="badge-value">Halaman ${source.halaman}</span>
      <span class="badge-score">${source.persen_kemiripan || (source.skor * 100).toFixed(1)}% Relevansi</span>
      <span class="badge-page">Chunk ID #${source.chunk_id || 1}</span>
    `;
    modalContent.textContent = source.teks;
    docModal.classList.remove('hidden');
  }

  modalCloseBtn.addEventListener('click', () => {
    docModal.classList.add('hidden');
  });

  docModal.addEventListener('click', (e) => {
    if (e.target === docModal) {
      docModal.classList.add('hidden');
    }
  });

  // Copy Message to Clipboard
  function setupCopyButton(btn, text) {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text);
        btn.innerHTML = `<i data-lucide="check"></i><span>Tersalin!</span>`;
        refreshIcons();
        setTimeout(() => {
          btn.innerHTML = `<i data-lucide="copy"></i><span>Salin</span>`;
          refreshIcons();
        }, 2000);
      } catch (err) {
        showToast('Gagal menyalin teks ke clipboard.', 'error');
      }
    });
  }

  // Handle Form Submission (Stream Interaction)
  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = messageInput.value.trim();
    if (!query || state.isGenerating) return;

    // Reset input
    messageInput.value = '';
    messageInput.style.height = 'auto';
    sendBtn.disabled = true;

    // Create new session if none is active
    if (!state.currentSessionId) {
      const newId = 'session_' + Date.now();
      const title = query.length > 36 ? query.substring(0, 36) + '...' : query;
      const newSession = {
        id: newId,
        title: title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: []
      };
      state.sessions.unshift(newSession);
      state.currentSessionId = newId;
    }

    // Save user message to active session
    const currentSession = state.sessions.find(s => s.id === state.currentSessionId);
    if (currentSession) {
      currentSession.messages.push({ role: 'user', content: query });
      currentSession.updatedAt = Date.now();
      saveSessionsToStorage();
      renderSessionList();
    }

    // Append User Message
    appendUserMessage(query);
    playSendSound();

    // Update UI state for Generation
    state.isGenerating = true;
    stopBtn.classList.remove('hidden');
    searchIndicator.classList.remove('hidden');
    searchIndicatorText.textContent = 'Mencari bagian relevan di dokumen PDF...';

    // Create Bot Row
    const botRowObj = createBotMessageRow();
    let accumulatedText = '';
    let sourcesReceived = null;

    state.abortController = new AbortController();

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: query,
          history: state.messages.slice(-6),
          top_k: state.topK
        }),
        signal: state.abortController.signal
      });

      if (!response.ok) {
        throw new Error(`Server status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;

          const jsonStr = trimmed.replace(/^data:\s*/, '');
          if (!jsonStr) continue;

          try {
            const eventData = JSON.parse(jsonStr);

            if (eventData.type === 'sources') {
              sourcesReceived = eventData.sources || [];
              searchIndicatorText.textContent = `Ditemukan ${sourcesReceived.length} bagian relevan. Menyusun jawaban...`;
              renderSourcesAccordion(botRowObj.sourcesPlaceholder, sourcesReceived);
            } else if (eventData.type === 'delta') {
              searchIndicator.classList.add('hidden');
              accumulatedText += eventData.text || '';
              botRowObj.bubbleContent.innerHTML = renderMarkdown(accumulatedText);
              scrollToBottom();
            } else if (eventData.type === 'error') {
              accumulatedText += `\n\n> ⚠️ **Error**: ${eventData.message}`;
              botRowObj.bubbleContent.innerHTML = renderMarkdown(accumulatedText);
            } else if (eventData.type === 'done') {
              // Generation complete
            }
          } catch (pe) {
            console.error('SSE JSON parse error:', pe, jsonStr);
          }
        }
      }

      // Finish generation
      playReceiveSound();
      const botMsgObj = {
        role: 'bot',
        content: accumulatedText,
        sources: sourcesReceived,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      state.messages.push(botMsgObj);

      if (currentSession) {
        currentSession.messages.push(botMsgObj);
        currentSession.updatedAt = Date.now();
        saveSessionsToStorage();
        renderSessionList();
      }

    } catch (err) {
      if (err.name === 'AbortError') {
        accumulatedText += '\n\n*(Jawaban dihentikan oleh pengguna)*';
        botRowObj.bubbleContent.innerHTML = renderMarkdown(accumulatedText);
        showToast('Pembuatan jawaban dihentikan.', 'info');
      } else {
        botRowObj.bubbleContent.innerHTML = `
          <div style="color:#b91c1c; font-size:0.9rem;">
            <i data-lucide="alert-circle" style="vertical-align:middle; width:16px;"></i>
            Gagal mendapatkan jawaban: ${escapeHtml(err.message)}
          </div>
        `;
        showToast('Terjadi kesalahan pada stream server.', 'error');
      }

      // Save partial message if available
      if (accumulatedText && currentSession) {
        currentSession.messages.push({
          role: 'bot',
          content: accumulatedText,
          sources: sourcesReceived
        });
        currentSession.updatedAt = Date.now();
        saveSessionsToStorage();
        renderSessionList();
      }
    } finally {
      // Remove typing cursor
      if (botRowObj.cursor) botRowObj.cursor.remove();

      // Show Action Bar
      botRowObj.actionsBar.classList.remove('hidden');
      setupCopyButton(botRowObj.copyBtn, accumulatedText);

      // Re-initialize Lucide icons in generated elements
      refreshIcons();

      // Reset state
      state.isGenerating = false;
      state.abortController = null;
      stopBtn.classList.add('hidden');
      searchIndicator.classList.add('hidden');
      sendBtn.disabled = !messageInput.value.trim();
      messageInput.focus();
      scrollToBottom();
    }
  });

  // Stop Generation Button
  stopBtn.addEventListener('click', () => {
    if (state.abortController) {
      state.abortController.abort();
    }
  });

  // New Chat Button
  newChatBtn.addEventListener('click', () => {
    startNewSession(true);
  });

  // Clear Chat Button
  clearChatBtn.addEventListener('click', () => {
    if (state.messages.length === 0 && !state.currentSessionId) {
      showToast('Belum ada pesan untuk dibersihkan.', 'info');
      return;
    }
    if (confirm('Apakah Anda yakin ingin menghapus percakapan aktif ini?')) {
      if (state.currentSessionId) {
        deleteSession(state.currentSessionId);
      } else {
        startNewSession(false);
      }
    }
  });

  // Export Chat Button
  exportChatBtn.addEventListener('click', () => {
    if (state.messages.length === 0) {
      showToast('Belum ada pesan untuk diekspor.', 'info');
      return;
    }

    let markdownContent = `# Riwayat Percakapan RAG AI Assistant\nTanggal: ${new Date().toLocaleString()}\n\n---\n\n`;

    state.messages.forEach(msg => {
      const sender = msg.role === 'user' ? '👤 Pengguna' : '🤖 RAG Gemini AI';
      markdownContent += `### ${sender}\n\n${msg.content}\n\n`;

      if (msg.sources && msg.sources.length > 0) {
        markdownContent += `**Referensi Dokumen:**\n`;
        msg.sources.forEach(s => {
          markdownContent += `- ${s.sumber} (Hal. ${s.halaman}) - Kemiripan: ${s.persen_kemiripan || (s.skor * 100).toFixed(0)}%\n`;
        });
        markdownContent += `\n`;
      }
      markdownContent += `---\n\n`;
    });

    const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-rag-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Percakapan berhasil diunduh sebagai file Markdown.', 'success');
  });

  // Reindex Button
  reindexBtn.addEventListener('click', handleReindex);

  // Mobile Sidebar Toggle
  function openSidebarMobile() {
    sidebar.classList.add('open');
    sidebarOverlay.classList.add('active');
  }

  function closeSidebarMobile() {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('active');
  }

  if (openSidebarBtn) openSidebarBtn.addEventListener('click', openSidebarMobile);
  if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', closeSidebarMobile);
  if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebarMobile);

  // Keyboard shortcut Esc to close modals/sidebar
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      docModal.classList.add('hidden');
      closeSidebarMobile();
    }
  });

  // Initial Data Load
  state.sessions = loadSessionsFromStorage();
  renderSessionList();
  if (state.sessions.length > 0) {
    loadSession(state.sessions[0].id);
  }
  fetchStatus();
});
