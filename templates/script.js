/* ========================================
   MDtoHTML フロントエンドスクリプト
   - Markdown を marked.js でHTML化
   - コードブロックを highlight.js でハイライト
   - 見出しから目次を生成
   - スクロール連動ハイライト（IntersectionObserver）
   - ダークモード切替（localStorage 保持）
   - サイドバー開閉（localStorage 保持）
   ======================================== */

(function () {
	"use strict";

	const STORAGE_KEY_THEME = "mdtohtml.theme";
	const STORAGE_KEY_SIDEBAR = "mdtohtml.sidebar";
	const STORAGE_KEY_EDIT = "mdtohtml.edit";
	const STORAGE_KEY_SPLIT = "mdtohtml.split";

	// ----- DOM 取得 -----
	const contentEl = document.getElementById("content");
	const tocEl = document.getElementById("toc");
	const sidebarEl = document.getElementById("sidebar");
	const themeToggleBtn = document.getElementById("theme-toggle");
	const sidebarToggleBtn = document.getElementById("sidebar-toggle");
	const refreshBtn = document.getElementById("refresh-btn");
	const editToggleBtn = document.getElementById("edit-toggle");
	const editCloseBtn = document.getElementById("edit-close-btn");
	const saveBtn = document.getElementById("save-btn");
	const editorEl = document.getElementById("editor");
	const splitterEl = document.getElementById("splitter");
	const workspaceEl = document.getElementById("workspace");
	const mdSourceEl = document.getElementById("md-source");
	const hljsLightLink = document.getElementById("hljs-light");
	const hljsDarkLink = document.getElementById("hljs-dark");

	// PS 側で </script> を <\/script> にエスケープしているため、編集用に復元する
	function unescapeScriptCloseTag(text) {
		return text.replace(/<\\\/script>/gi, "</script>");
	}

	// 現在のMarkdownソース（編集中はtextareaが真の状態）
	let currentSource = mdSourceEl ? unescapeScriptCloseTag(mdSourceEl.textContent) : "";
	// 保存済みソース（dirty判定用）
	let savedSource = currentSource;

	// ----- Markdown レンダリング -----
	function renderMarkdown() {
		// marked のオプション設定
		marked.setOptions({
			gfm: true,
			breaks: false,
			headerIds: false,  // 自前でID付与するため無効化
			mangle: false
		});

		const html = marked.parse(currentSource);
		contentEl.innerHTML = html;
		contentEl.removeAttribute("aria-busy");

		// Mermaid: ```mermaid ブロックを <div class="mermaid"> に置換
		// （hljs より先に行い、コードハイライト対象から外す）
		transformMermaidBlocks();

		// コードハイライト（Mermaid 用 div は対象外）
		if (window.hljs) {
			contentEl.querySelectorAll("pre code").forEach((block) => {
				try {
					hljs.highlightElement(block);
				} catch (e) {
					// ハイライト失敗時は無視（プレーン表示）
				}
			});
		}

		// Mermaid 描画（mermaid 読み込み完了を待ってから実行）
		renderMermaidDiagrams();
	}

	// ----- Mermaid -----
	// marked が生成する <pre><code class="language-mermaid">…</code></pre> を
	// <div class="mermaid">…</div> に置換する。
	function transformMermaidBlocks() {
		const blocks = contentEl.querySelectorAll('pre > code.language-mermaid');
		blocks.forEach((codeEl) => {
			const pre = codeEl.parentElement;
			const div = document.createElement('div');
			div.className = 'mermaid';
			div.textContent = codeEl.textContent;
			pre.replaceWith(div);
		});
	}

	function renderMermaidDiagrams() {
		const targets = contentEl.querySelectorAll('.mermaid');
		if (targets.length === 0) return;

		const run = () => {
			try {
				window.mermaid.run({ nodes: targets });
			} catch (e) {
				console.warn('Mermaid render failed:', e);
			}
		};

		if (window.mermaid) {
			run();
		} else {
			window.addEventListener('mermaid-ready', run, { once: true });
		}
	}

	// ----- 見出しに ID を付与し、目次を構築 -----
	function buildToc() {
		const headings = contentEl.querySelectorAll("h1, h2, h3, h4, h5, h6");
		if (headings.length === 0) {
			tocEl.innerHTML = '<p style="padding:12px;color:var(--fg-muted);font-size:0.85em;">見出しがありません</p>';
			return [];
		}

		const usedIds = new Set();
		const items = [];

		headings.forEach((h) => {
			const id = makeUniqueId(slugify(h.textContent), usedIds);
			h.id = id;
			usedIds.add(id);
			items.push({
				id: id,
				text: h.textContent,
				level: parseInt(h.tagName.substring(1), 10),
				element: h
			});
		});

		// 一覧を生成
		const ul = document.createElement("ul");
		items.forEach((item) => {
			const li = document.createElement("li");
			const a = document.createElement("a");
			a.href = "#" + item.id;
			a.textContent = item.text;
			a.className = "toc-h" + item.level;
			a.dataset.targetId = item.id;
			a.addEventListener("click", (ev) => {
				ev.preventDefault();
				const target = document.getElementById(item.id);
				if (target) {
					target.scrollIntoView({ behavior: "smooth", block: "start" });
					history.replaceState(null, "", "#" + item.id);
				}
			});
			li.appendChild(a);
			ul.appendChild(li);
		});

		tocEl.innerHTML = "";
		tocEl.appendChild(ul);
		return items;
	}

	// 文字列を ID 用にスラッグ化（日本語はそのまま、空白・記号を - に）
	function slugify(text) {
		return text
			.trim()
			.toLowerCase()
			.replace(/[\s　]+/g, "-")
			.replace(/[^\w぀-ヿ㐀-鿿\-]/g, "")
			|| "section";
	}

	function makeUniqueId(base, used) {
		let id = base;
		let n = 1;
		while (used.has(id)) {
			id = base + "-" + (++n);
		}
		return id;
	}

	// ----- スクロール連動：現在位置をハイライト -----
	function setupScrollSpy(items) {
		if (items.length === 0) return;

		const linkById = new Map();
		tocEl.querySelectorAll("a").forEach((a) => {
			linkById.set(a.dataset.targetId, a);
		});

		let activeId = null;
		const visible = new Map();

		const observer = new IntersectionObserver((entries) => {
			entries.forEach((entry) => {
				if (entry.isIntersecting) {
					visible.set(entry.target.id, entry.intersectionRatio);
				} else {
					visible.delete(entry.target.id);
				}
			});

			let topId = null;
			if (visible.size > 0) {
				// 画面内で最も上にある見出しを採用
				let topY = Infinity;
				visible.forEach((_, id) => {
					const el = document.getElementById(id);
					if (!el) return;
					const y = el.getBoundingClientRect().top;
					if (y < topY) {
						topY = y;
						topId = id;
					}
				});
			} else {
				// 画面に見出しが無い場合は、ビューポート上端より上で最も近いものを選択
				topId = findNearestAboveViewport(items);
			}

			if (topId !== activeId) {
				if (activeId && linkById.has(activeId)) {
					linkById.get(activeId).classList.remove("active");
				}
				if (topId && linkById.has(topId)) {
					linkById.get(topId).classList.add("active");
					scrollTocIntoView(linkById.get(topId));
				}
				activeId = topId;
			}
		}, {
			// 上部 0px / 下部はビューポート下60% を無視 → 「画面上部に来た見出し」で発火
			rootMargin: "0px 0px -60% 0px",
			threshold: [0, 1]
		});

		items.forEach((item) => observer.observe(item.element));

		// スクロール時の補助：observer が拾えない端でもアクティブ更新
		window.addEventListener("scroll", () => {
			if (visible.size > 0) return;
			const id = findNearestAboveViewport(items);
			if (id && id !== activeId) {
				if (activeId && linkById.has(activeId)) {
					linkById.get(activeId).classList.remove("active");
				}
				if (linkById.has(id)) {
					linkById.get(id).classList.add("active");
					scrollTocIntoView(linkById.get(id));
				}
				activeId = id;
			}
		}, { passive: true });
	}

	function findNearestAboveViewport(items) {
		let candidate = null;
		for (const item of items) {
			const top = item.element.getBoundingClientRect().top;
			if (top <= 24) {
				candidate = item.id;
			} else {
				break;
			}
		}
		return candidate;
	}

	function scrollTocIntoView(linkEl) {
		// TOC内でアクティブ項目が見えるように追従スクロール
		const tocRect = tocEl.getBoundingClientRect();
		const linkRect = linkEl.getBoundingClientRect();
		if (linkRect.top < tocRect.top || linkRect.bottom > tocRect.bottom) {
			linkEl.scrollIntoView({ block: "nearest" });
		}
	}

	// ----- ダークモード -----
	function applyTheme(theme) {
		if (theme === "dark") {
			document.body.classList.add("theme-dark");
			themeToggleBtn.textContent = "☀";
			hljsLightLink.disabled = true;
			hljsDarkLink.disabled = false;
		} else {
			document.body.classList.remove("theme-dark");
			themeToggleBtn.textContent = "☾";
			hljsLightLink.disabled = false;
			hljsDarkLink.disabled = true;
		}
	}

	function initTheme() {
		let theme = localStorage.getItem(STORAGE_KEY_THEME);
		if (!theme) {
			theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
				? "dark" : "light";
		}
		applyTheme(theme);
	}

	themeToggleBtn.addEventListener("click", () => {
		const next = document.body.classList.contains("theme-dark") ? "light" : "dark";
		applyTheme(next);
		localStorage.setItem(STORAGE_KEY_THEME, next);
	});

	// ----- サイドバー開閉 -----
	function applySidebar(open) {
		document.body.classList.toggle("sidebar-open", open);
	}

	function initSidebar() {
		const saved = localStorage.getItem(STORAGE_KEY_SIDEBAR);
		// 初期表示はデフォルトで開く（小画面では閉じる）
		const isNarrow = window.innerWidth < 1100;
		const open = saved === null ? !isNarrow : saved === "open";
		applySidebar(open);
	}

	sidebarToggleBtn.addEventListener("click", () => {
		const open = !document.body.classList.contains("sidebar-open");
		applySidebar(open);
		localStorage.setItem(STORAGE_KEY_SIDEBAR, open ? "open" : "closed");
	});

	// ----- 更新（HTML 再生成） -----
	// mdtohtml:// カスタム URI を経由して MDtoHTML.bat を再実行する。
	// プロトコルは scripts/Register-Protocol.bat で事前に登録しておく必要がある。
	function getSourcePath() {
		const meta = document.querySelector('meta[name="md-source-path"]');
		return meta ? meta.getAttribute("content") : "";
	}

	if (refreshBtn) {
		refreshBtn.addEventListener("click", () => {
			const path = getSourcePath();
			if (!path) {
				alert("ソースファイルパスが取得できませんでした。");
				return;
			}
			// 編集中で未保存の変更がある場合は確認
			if (isDirty() && !confirm("未保存の変更があります。破棄して再生成しますか？")) {
				return;
			}
			// プロトコル発火は隠しリンクのクリックで行う（現タブを遷移させない）。
			// PowerShell 側はプロトコル呼び出し時、出力 HTML を同じパスへ上書きし
			// 新しいタブは開かない。少し待ってから現タブを reload して結果を反映する。
			triggerProtocol("mdtohtml:" + encodeURIComponent(path));

			// PowerShell の処理時間を見込んで reload。多少長めに設定。
			refreshBtn.disabled = true;
			refreshBtn.textContent = "…";
			setTimeout(() => {
				location.reload();
			}, 1500);
		});
	}

	// プロトコルURL を発火（隠しリンク経由で現タブを遷移させない）
	function triggerProtocol(url) {
		const a = document.createElement("a");
		a.href = url;
		a.style.display = "none";
		document.body.appendChild(a);
		a.click();
		a.remove();
	}

	// ----- 編集モード -----
	function isDirty() {
		return currentSource !== savedSource;
	}

	function updateSaveButtonState() {
		if (!saveBtn) return;
		saveBtn.classList.toggle("is-dirty", isDirty());
	}

	function applyEditMode(on) {
		document.body.classList.toggle("edit-mode", on);
		// アイコンは変えず、押下状態だけクラスで表現する
		if (editToggleBtn) {
			editToggleBtn.classList.toggle("is-active", on);
			editToggleBtn.setAttribute("aria-pressed", on ? "true" : "false");
			editToggleBtn.title = on ? "編集モードを終了" : "編集モード切替";
		}
		if (on && editorEl) {
			// 編集開始時：textareaの内容を最新ソースに同期
			if (editorEl.value !== currentSource) {
				editorEl.value = currentSource;
			}
			// フォーカスを当てて編集しやすくする
			setTimeout(() => editorEl.focus(), 0);
		}
	}

	function initEditMode() {
		const saved = localStorage.getItem(STORAGE_KEY_EDIT);
		const on = saved === "on";
		// 初期化時にtextareaへ現在のソースを流し込む
		if (editorEl) editorEl.value = currentSource;
		applyEditMode(on);
	}

	if (editToggleBtn) {
		editToggleBtn.addEventListener("click", () => {
			const on = !document.body.classList.contains("edit-mode");
			applyEditMode(on);
			localStorage.setItem(STORAGE_KEY_EDIT, on ? "on" : "off");
		});
	}

	// 編集ペイン右上の × ボタン：編集モードを終了
	if (editCloseBtn) {
		editCloseBtn.addEventListener("click", () => {
			applyEditMode(false);
			localStorage.setItem(STORAGE_KEY_EDIT, "off");
		});
	}

	// ----- ライブプレビュー（即時反映：rAF で次フレームに描画を集約） -----
	let renderScheduled = false;
	if (editorEl) {
		editorEl.addEventListener("input", () => {
			currentSource = editorEl.value;
			updateSaveButtonState();
			if (!renderScheduled) {
				renderScheduled = true;
				requestAnimationFrame(() => {
					renderScheduled = false;
					renderMarkdown();
				});
			}
		});

		// Tab キーでインデント挿入（フォーカス移動を抑止）
		editorEl.addEventListener("keydown", (ev) => {
			if (ev.key === "Tab") {
				ev.preventDefault();
				const start = editorEl.selectionStart;
				const end = editorEl.selectionEnd;
				const indent = "\t";
				editorEl.value = editorEl.value.slice(0, start) + indent + editorEl.value.slice(end);
				editorEl.selectionStart = editorEl.selectionEnd = start + indent.length;
				// input イベントを手動で発火
				editorEl.dispatchEvent(new Event("input", { bubbles: true }));
			} else if ((ev.ctrlKey || ev.metaKey) && ev.key === "s") {
				// Ctrl+S で保存
				ev.preventDefault();
				if (saveBtn && !saveBtn.disabled) saveBtn.click();
			}
		});
	}

	// ----- 保存（mdtohtml://save/<path> 経由） -----
	async function copyToClipboard(text) {
		// 1) Async Clipboard API（モダンブラウザ・file://でも多くは可）
		if (navigator.clipboard && navigator.clipboard.writeText) {
			try {
				await navigator.clipboard.writeText(text);
				return true;
			} catch (e) {
				// permission拒否などは fallback へ
			}
		}
		// 2) execCommand fallback
		try {
			const ta = document.createElement("textarea");
			ta.value = text;
			ta.style.position = "fixed";
			ta.style.top = "0";
			ta.style.left = "0";
			ta.style.opacity = "0";
			document.body.appendChild(ta);
			ta.focus();
			ta.select();
			const ok = document.execCommand("copy");
			ta.remove();
			return ok;
		} catch (e) {
			return false;
		}
	}

	async function saveContent() {
		if (!saveBtn) return;
		const path = getSourcePath();
		if (!path) {
			alert("ソースファイルパスが取得できませんでした。");
			return;
		}
		const content = editorEl ? editorEl.value : currentSource;

		saveBtn.disabled = true;
		const prevText = saveBtn.textContent;
		saveBtn.textContent = "…";

		const copied = await copyToClipboard(content);
		if (!copied) {
			saveBtn.disabled = false;
			saveBtn.textContent = prevText;
			alert("クリップボードへのコピーに失敗しました。\nブラウザの権限設定を確認してください。");
			return;
		}

		// プロトコル経由でPowerShellを起動：クリップボードを読んで .md に書き戻し、HTMLを再生成する
		triggerProtocol("mdtohtml://save/" + encodeURIComponent(path));

		// 保存完了とみなしてフラグ更新（reload で最新化される）
		savedSource = content;
		updateSaveButtonState();

		// PowerShell の処理時間を見込んで reload
		setTimeout(() => {
			location.reload();
		}, 1500);
	}

	if (saveBtn) {
		saveBtn.addEventListener("click", () => {
			saveContent();
		});
	}

	// ページ離脱時の警告
	window.addEventListener("beforeunload", (ev) => {
		if (isDirty()) {
			ev.preventDefault();
			ev.returnValue = "";
		}
	});

	// ----- スプリッター（プレビュー / エディタ間のサイズ調整） -----
	function clampRatio(r) {
		if (!isFinite(r)) return 0.5;
		return Math.max(0.15, Math.min(0.85, r));
	}

	function applySplitRatio(ratio) {
		if (!workspaceEl) return;
		const r = clampRatio(ratio);
		workspaceEl.style.gridTemplateColumns = r.toFixed(4) + "fr 6px " + (1 - r).toFixed(4) + "fr";
	}

	function ratioFromPointer(ev) {
		const wsRect = workspaceEl.getBoundingClientRect();
		if (wsRect.width <= 0) return 0.5;
		return clampRatio((ev.clientX - wsRect.left) / wsRect.width);
	}

	function initSplitter() {
		const saved = parseFloat(localStorage.getItem(STORAGE_KEY_SPLIT));
		if (!isNaN(saved)) {
			applySplitRatio(saved);
		}
	}

	if (splitterEl && workspaceEl) {
		let isDragging = false;

		splitterEl.addEventListener("pointerdown", (ev) => {
			if (!document.body.classList.contains("edit-mode")) return;
			ev.preventDefault();
			isDragging = true;
			document.body.classList.add("is-resizing");
			try { splitterEl.setPointerCapture(ev.pointerId); } catch (e) { /* noop */ }
		});

		splitterEl.addEventListener("pointermove", (ev) => {
			if (!isDragging) return;
			applySplitRatio(ratioFromPointer(ev));
		});

		const endDrag = (ev) => {
			if (!isDragging) return;
			isDragging = false;
			document.body.classList.remove("is-resizing");
			try { splitterEl.releasePointerCapture(ev.pointerId); } catch (e) { /* noop */ }
			if (ev && typeof ev.clientX === "number") {
				localStorage.setItem(STORAGE_KEY_SPLIT, String(ratioFromPointer(ev)));
			}
		};

		splitterEl.addEventListener("pointerup", endDrag);
		splitterEl.addEventListener("pointercancel", endDrag);

		// ダブルクリックで 50:50 にリセット
		splitterEl.addEventListener("dblclick", () => {
			applySplitRatio(0.5);
			localStorage.setItem(STORAGE_KEY_SPLIT, "0.5");
		});
	}

	// ----- 初期化 -----
	function init() {
		initTheme();
		renderMarkdown();
		const items = buildToc();
		setupScrollSpy(items);
		initSidebar();
		initSplitter();
		initEditMode();
		updateSaveButtonState();

		// URL ハッシュがあれば該当箇所へスクロール
		if (location.hash) {
			const target = document.getElementById(decodeURIComponent(location.hash.substring(1)));
			if (target) {
				target.scrollIntoView({ block: "start" });
			}
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
