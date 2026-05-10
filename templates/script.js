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

	// ----- DOM 取得 -----
	const contentEl = document.getElementById("content");
	const tocEl = document.getElementById("toc");
	const sidebarEl = document.getElementById("sidebar");
	const themeToggleBtn = document.getElementById("theme-toggle");
	const sidebarToggleBtn = document.getElementById("sidebar-toggle");
	const refreshBtn = document.getElementById("refresh-btn");
	const mdSourceEl = document.getElementById("md-source");
	const hljsLightLink = document.getElementById("hljs-light");
	const hljsDarkLink = document.getElementById("hljs-dark");

	// ----- Markdown レンダリング -----
	function renderMarkdown() {
		const mdText = mdSourceEl ? mdSourceEl.textContent : "";

		// marked のオプション設定
		marked.setOptions({
			gfm: true,
			breaks: false,
			headerIds: false,  // 自前でID付与するため無効化
			mangle: false
		});

		const html = marked.parse(mdText);
		contentEl.innerHTML = html;
		contentEl.removeAttribute("aria-busy");

		// コードハイライト
		if (window.hljs) {
			contentEl.querySelectorAll("pre code").forEach((block) => {
				try {
					hljs.highlightElement(block);
				} catch (e) {
					// ハイライト失敗時は無視（プレーン表示）
				}
			});
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
			themeToggleBtn.textContent = "🌙";
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
			// パスを URL エンコードして mdtohtml: プロトコルへ渡す
			window.location.href = "mdtohtml:" + encodeURIComponent(path);
		});
	}

	// ----- 初期化 -----
	function init() {
		initTheme();
		renderMarkdown();
		const items = buildToc();
		setupScrollSpy(items);
		initSidebar();

		// URL ハッシュがあれば該当箇所へスクロール
		if (location.hash) {
			const target = document.getElementById(decodeURIComponent(location.hash.substring(1)));
			if (target) {
				target.scrollIntoView({ block: "start" });
			}
		}

		// タイトルを最初の h1 から設定（テンプレート側で既に設定済みでも上書き可）
		const firstH1 = contentEl.querySelector("h1");
		if (firstH1) {
			document.title = firstH1.textContent;
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
