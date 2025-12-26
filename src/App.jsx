import { useState, useEffect, useRef, useMemo } from "react";
import Swal from "sweetalert2";
import {
  X,
  Menu,
  Search,
  Download,
  Trash2,
  Edit3,
  Send,
  HelpCircle,
  Plus,
} from "lucide-react";

// --- Breakpoint Hook ---
const useIsBelowBreakpoint = breakpoint => {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(`(max-width: ${breakpoint}px)`).matches;
  });

  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = event => setIsMobile(event.matches);

    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [breakpoint]);

  return isMobile;
};

// --- Icon Component ---
const Icon = ({ name, size = 16, className = "" }) => {
  const iconMap = {
    x: X,
    menu: Menu,
    search: Search,
    download: Download,
    "trash-2": Trash2,
    "edit-3": Edit3,
    send: Send,
    plus: Plus,
  };

  const LucideIcon = iconMap[name] || HelpCircle;
  return <LucideIcon size={size} className={className} />;
};

const App = () => {
  const [profiles, setProfiles] = useState(
    () => JSON.parse(localStorage.getItem("webhook_profiles")) || []
  );
  const [activeIdx, setActiveIdx] = useState(() => {
    const saved = localStorage.getItem("active_profile_index");
    return saved !== null && saved !== "null" ? parseInt(saved) : null;
  });
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const [isSearchExpanded, setSearchExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [mode, setMode] = useState("text");
  const [inputText, setInputText] = useState("");
  const [embed, setEmbed] = useState({
    title: "",
    description: "",
    color: "#5865f2",
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const isTiny = useIsBelowBreakpoint(450);
  const messageEndRef = useRef(null);
  const activeProfile = activeIdx !== null ? profiles[activeIdx] : null;

  useEffect(() => {
    localStorage.setItem("webhook_profiles", JSON.stringify(profiles));
    localStorage.setItem("active_profile_index", activeIdx);
  }, [profiles, activeIdx]);

  useEffect(() => {
    if (activeProfile) pullMessages();
  }, [activeIdx]);

  const filteredMessages = useMemo(() => {
    if (!activeProfile) return [];
    if (!searchQuery) return activeProfile.messages;
    const q = searchQuery.toLowerCase();
    return activeProfile.messages.filter(
      m =>
        m.payload.content?.toLowerCase().includes(q) ||
        m.payload.embeds?.[0]?.title?.toLowerCase().includes(q) ||
        m.payload.embeds?.[0]?.description?.toLowerCase().includes(q)
    );
  }, [activeProfile, searchQuery]);

  const scrollToBottom = () =>
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });

  const pullMessages = async () => {
    if (!activeProfile || activeProfile.messages.length === 0) return;
    setIsProcessing(true);
    try {
      const results = await Promise.allSettled(
        activeProfile.messages.map(async m => {
          try {
            const res = await fetch(`${activeProfile.url}/messages/${m.id}`);
            if (res.status === 404) throw new Error("Deleted");
            if (!res.ok) return m;
            const data = await res.json();
            return {
              ...m,
              payload: {
                ...m.payload,
                content: data.content,
                embeds: data.embeds,
              },
            };
          } catch (e) {
            if (e.message === "Deleted") throw e;
            return m;
          }
        })
      );

      const synced = [];
      results.forEach(res => {
        if (res.status === "fulfilled") synced.push(res.value);
      });

      setProfiles(prev => {
        const updated = [...prev];
        updated[activeIdx] = { ...updated[activeIdx], messages: synced };
        return updated;
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const addManualMessage = async () => {
    const { value: messageId } = await Swal.fire({
      title: "Import Message By ID",
      html: `
       <label class="swal-form-label" for="message-id">Message ID</label>
       <input class="swal2-input" id="message-id">`,
      showCancelButton: true,
      confirmButtonText: "Add to History",
      inputValidator: value => {
        if (!value) return "You must provide a message ID";
      },
      preConfirm: () => {
        const input = document.getElementById("message-id");
        const value = input.value.trim();
        if (!value) {
          Swal.showValidationMessage("You must provide a message ID");
          return false;
        }
        return value;
      },
    });

    if (messageId) {
      setIsProcessing(true);
      try {
        const res = await fetch(`${activeProfile.url}/messages/${messageId}`);
        if (!res.ok) throw new Error();
        const data = await res.json();

        setProfiles(prev => {
          const updated = [...prev];
          const currentProf = { ...updated[activeIdx] };

          if (currentProf.messages.some(m => m.id === messageId)) {
            Swal.fire(
              "Already Tracked",
              "This message is already in your history.",
              "info"
            );
            return prev;
          }

          const newMsg = {
            id: messageId,
            payload: { content: data.content, embeds: data.embeds },
            timestamp: new Date().toLocaleTimeString() + " (Imported)",
          };

          currentProf.messages = [...currentProf.messages, newMsg];
          updated[activeIdx] = currentProf;
          return updated;
        });
      } catch {
        Swal.fire(
          "Error",
          "Could not find message. Ensure ID is correct for this Webhook.",
          "error"
        );
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const sendMessage = async () => {
    if (!activeProfile || isSending) return;
    let payload =
      mode === "text"
        ? { content: inputText.trim() }
        : {
            embeds: [
              { ...embed, color: parseInt(embed.color.replace("#", ""), 16) },
            ],
          };

    if (mode === "text" && !payload.content) return;

    setIsSending(true);
    try {
      const res = await fetch(`${activeProfile.url}?wait=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        const newMsg = {
          id: data.id,
          payload,
          timestamp: new Date().toLocaleTimeString(),
        };

        setProfiles(prev => {
          const updated = [...prev];
          const currentProf = { ...updated[activeIdx] };
          if (mode === "embed") {
            const history = currentProf.colorHistory || [];
            currentProf.colorHistory = [
              embed.color,
              ...history.filter(c => c !== embed.color),
            ].slice(0, 5);
          }
          currentProf.messages = [...currentProf.messages, newMsg];
          updated[activeIdx] = currentProf;
          return updated;
        });

        setInputText("");
        setEmbed(prev => ({ ...prev, title: "", description: "" }));
        setTimeout(scrollToBottom, 50);
      }
    } finally {
      setIsSending(false);
    }
  };

  const editMessage = async msgId => {
    const msg = activeProfile.messages.find(m => m.id === msgId);
    const isEmbed = !!(msg.payload.embeds && msg.payload.embeds.length > 0);
    const { value: formValues } = await Swal.fire({
      title: "Edit Message",
      html: `
        <div class="flex flex-col text-left">
          ${
            isEmbed
              ? `
            <label class="swal-form-label" for="edit-title">Title</label>
            <input id="edit-title" class="swal2-input" value="${
              msg.payload.embeds[0].title || ""
            }">
            <label class="swal-form-label" for="edit-desc">Description</label>
            <textarea id="edit-desc" class="swal2-textarea" rows="4">${
              msg.payload.embeds[0].description || ""
            }</textarea>
          `
              : `
            <label class="swal-form-label" for="edit-content">Content</label>
            <textarea id="edit-content" class="swal2-textarea" rows="6">${
              msg.payload.content || ""
            }</textarea>
          `
          }
        </div>
      `,
      showCancelButton: true,
      preConfirm: () =>
        isEmbed
          ? {
              embeds: [
                {
                  title: document.getElementById("edit-title").value,
                  description: document.getElementById("edit-desc").value,
                  color: msg.payload.embeds[0].color,
                },
              ],
            }
          : { content: document.getElementById("edit-content").value },
    });
    if (formValues) {
      const res = await fetch(`${activeProfile.url}/messages/${msgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formValues),
      });
      if (res.ok) {
        setProfiles(prev => {
          const updated = [...prev];
          const currentProf = { ...updated[activeIdx] };
          currentProf.messages = currentProf.messages.map(m =>
            m.id === msgId ? { ...m, payload: formValues } : m
          );
          updated[activeIdx] = currentProf;
          return updated;
        });
      }
    }
  };

  const profileForm = async (idx = null) => {
    const p =
      idx !== null ? profiles[idx] : { name: "", nickname: "", url: "" };
    const { value: f } = await Swal.fire({
      title: idx !== null ? "Edit Profile" : "New Webhook Profile",
      html: `
        <div class="flex flex-col text-left">
          <label class="swal-form-label required for="p-name">Profile Name</label>
          <input id="p-name" class="swal2-input" value="${p.name}">
          <label class="swal-form-label" for="p-nick">Bot Nickname</label>
          <input id="p-nick" class="swal2-input" value="${p.nickname || ""}">
          <label class="swal-form-label" required for="p-url">Webhook URL</label>
          <input id="p-url" class="swal2-input" value="${p.url}">
        </div>
      `,
      showCancelButton: true,
      preConfirm: () => {
        const name = document.getElementById("p-name").value;
        const url = document.getElementById("p-url").value;
        if (!name || !url)
          return Swal.showValidationMessage("Required fields missing");
        try {
          const validatedUrl = new URL(url);
          const isDiscord = validatedUrl.hostname.includes("discord");
          const isWebhookPath =
            validatedUrl.pathname.includes("/api/webhooks/");
          if (!isDiscord || !isWebhookPath)
            return Swal.showValidationMessage("Invalid Discord Webhook URL");
        } catch {
          return Swal.showValidationMessage("Invalid URL format");
        }
        return { name, nickname: document.getElementById("p-nick").value, url };
      },
    });
    if (f) {
      const up = [...profiles];
      if (idx !== null) up[idx] = { ...p, ...f };
      else up.push({ ...f, messages: [], colorHistory: [] });
      setProfiles(up);
      if (idx === null) setActiveIdx(up.length - 1);
    }
  };

  const Sidebar = ({ className, showClose }) => (
    <nav
      className={`${className} flex flex-col border-r border-(--border) h-full bg-(--bg-sidebar)`}>
      <div className="h-14 flex items-center justify-between px-4 border-b border-(--border) shrink-0">
        <div className="flex items-center gap-2">
          {showClose && (
            <button
              onClick={() => setDrawerOpen(false)}
              className="p-1 -ml-1 text-[#949ba4] hover:text-white flex items-center justify-center h-8 w-8 rounded hover:bg-black/10">
              <Icon name="x" size={20} />
            </button>
          )}
          <span className="font-bold text-xs uppercase tracking-widest text-[#949ba4] leading-none">
            Profiles
          </span>
        </div>
        <button
          onClick={() => profileForm()}
          className="bg-[#248046] hover:bg-[#1a6334] text-white w-7 h-7 rounded-full flex items-center justify-center transition-all leading-none">
          <Icon name="plus" size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {profiles.map((p, i) => (
          <div
            key={i}
            className={`group flex items-center gap-1 mb-1 rounded px-1 transition-all ${
              activeIdx === i ? "bg-black/20" : "hover:bg-black/10"
            }`}>
            <button
              onClick={() => {
                setActiveIdx(i);
                setDrawerOpen(false);
              }}
              className={`flex-1 text-left py-2 px-1 text-sm font-medium truncate ${
                activeIdx === i ? "text-(--text-header)" : "text-[#949ba4]"
              }`}>
              {p.name}
            </button>
            <div
              className={`flex items-center gap-0.5 ${
                activeIdx === i
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100"
              }`}>
              <button
                onClick={() => profileForm(i)}
                className="p-1.5 text-gray-500 hover:text-white flex items-center">
                <Icon name="edit-3" size={14} />
              </button>
              <button
                onClick={() => {
                  Swal.fire({
                    title: "Delete Profile?",
                    showCancelButton: true,
                  }).then(r => {
                    if (r.isConfirmed) {
                      const filtered = profiles.filter((_, idx) => idx !== i);
                      setProfiles(filtered);
                      setActiveIdx(filtered.length > 0 ? 0 : null);
                    }
                  });
                }}
                className="p-1.5 text-gray-500 hover:text-red-500 flex items-center">
                <Icon name="trash-2" size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </nav>
  );

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <Sidebar className="hidden sm:flex w-64" />
      <div
        className={`fixed inset-0 z-50 sm:hidden transition-opacity duration-300 ${
          isDrawerOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}>
        <div
          className="absolute inset-0 bg-black/60"
          onClick={() => setDrawerOpen(false)}></div>
        <div
          className={`absolute inset-y-0 left-0 w-4/5 max-w-sm transform transition-transform duration-300 ${
            isDrawerOpen ? "translate-x-0" : "-translate-x-full"
          }`}>
          <Sidebar className="w-full" showClose />
        </div>
      </div>
      <main className="flex-1 flex flex-col min-w-0 bg-(--bg-main)">
        <header
          className={`header flex flex-col justify-center px-4 shrink-0 z-10 transition-all ${
            isTiny ? "h-24" : "h-14"
          }`}>
          <div className="flex items-center justify-between w-full h-14">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDrawerOpen(true)}
                className="sm:hidden p-1 text-[#949ba4] hover:text-white flex items-center justify-center h-8 w-8 rounded hover:bg-black/10">
                <Icon name="menu" size={20} />
              </button>
              <h2 className="font-bold text-sm text-(--text-header) truncate max-w-[100px] sm:max-w-none leading-none">
                {activeProfile ? activeProfile.name : "Webhooks"}
              </h2>

              {!isTiny && activeProfile && (
                <div
                  className={`relative flex items-center transition-all duration-300 ${
                    isSearchExpanded ? "w-48 sm:w-64" : "w-8"
                  }`}>
                  <button
                    onClick={() => setSearchExpanded(!isSearchExpanded)}
                    className={`flex items-center justify-center h-8 w-8 rounded-full hover:bg-black/10 text-gray-400 ${
                      isSearchExpanded ? "absolute left-0 z-10" : ""
                    }`}>
                    <Icon name="search" size={18} />
                  </button>
                  {isSearchExpanded && (
                    <div className="flex items-center w-full relative">
                      <input
                        autoFocus
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Search messages..."
                        className="w-full bg-(--bg-input) text-xs h-8 rounded-full outline-none pl-9 pr-8 focus:ring-1 ring-[#5865f2]"
                      />
                      <button
                        onClick={() => {
                          setSearchQuery("");
                          setSearchExpanded(false);
                        }}
                        className="absolute right-2 text-gray-500 hover:text-white flex items-center">
                        <Icon name="x" size={14} />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {activeProfile && (
              <div className="flex gap-2">
                <button
                  onClick={addManualMessage}
                  disabled={isProcessing}
                  className="flex h-8 items-center gap-1.5 px-3 rounded bg-[#248046] hover:bg-[#1a6334] text-[11px] text-white font-semibold transition-colors disabled:opacity-50">
                  <Icon name="plus" size={14} />{" "}
                  <span className="hidden sm:inline">Import Message</span>
                </button>
                <button
                  onClick={() => {
                    Swal.fire({
                      title: "Delete All Messages?",
                      showCancelButton: true,
                    }).then(r => {
                      if (r.isConfirmed) {
                        setIsProcessing(true);
                        Promise.allSettled(
                          activeProfile.messages.map(m =>
                            fetch(`${activeProfile.url}/messages/${m.id}`, {
                              method: "DELETE",
                            })
                          )
                        ).finally(() => {
                          setProfiles(prev => {
                            const up = [...prev];
                            up[activeIdx] = { ...up[activeIdx], messages: [] };
                            return up;
                          });
                          setIsProcessing(false);
                        });
                      }
                    });
                  }}
                  className="flex h-8 items-center gap-1.5 px-3 rounded bg-[#da373c] hover:bg-[#a12828] text-[11px] text-white font-semibold transition-colors">
                  <Icon name="trash-2" size={14} />{" "}
                  <span className="hidden sm:inline">Delete All Messages</span>
                </button>
              </div>
            )}
          </div>

          {isTiny && activeProfile && (
            <div className="w-full pb-2 px-1">
              <div className="flex items-center w-full relative">
                <div className="absolute left-3 text-gray-400">
                  <Icon name="search" size={14} />
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search messages..."
                  className="w-full bg-(--bg-input) text-xs h-8 pl-9 pr-8 rounded-lg outline-none focus:ring-1 ring-[#5865f2]"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 text-gray-500 hover:text-white">
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
            </div>
          )}
        </header>
        <section className="flex-1 overflow-y-auto">
          {!activeProfile ? (
            <div className="h-full flex flex-col items-center justify-center opacity-30 italic">
              <p>Select a profile to start.</p>
            </div>
          ) : (
            <div className="flex flex-col py-4">
              {filteredMessages.map(m => {
                const hasEmbeds =
                  m.payload.embeds && m.payload.embeds.length > 0;
                const embedColor = hasEmbeds ? m.payload.embeds[0].color : null;
                const borderStyle = embedColor
                  ? `#${embedColor.toString(16).padStart(6, "0")}`
                  : "#5865f2";

                return (
                  <div
                    key={m.id}
                    className="group flex flex-col p-3 sm:p-4 hover:bg-black/5 relative transition-colors">
                    <div className="flex justify-between items-start">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[#5865f2] font-semibold text-sm">
                            {activeProfile.nickname || "Webhook"}
                          </span>
                          <span className="bg-[#5865f2] text-white text-[9px] px-1 rounded font-bold uppercase py-0.5 leading-none">
                            App
                          </span>
                          <span className="text-[10px] text-[#949ba4] font-medium">
                            {m.timestamp}
                          </span>
                        </div>
                        {hasEmbeds ? (
                          <div
                            className="bg-black/10 border-l-4 p-3 rounded mt-1 max-w-2xl shadow-sm"
                            style={{ borderColor: borderStyle }}>
                            {m.payload.embeds[0].title && (
                              <div className="font-bold text-sm text-(--text-header)">
                                {m.payload.embeds[0].title}
                              </div>
                            )}
                            <div className="text-sm mt-1 whitespace-pre-wrap leading-relaxed wrap-break-word hyphens-auto">
                              {m.payload.embeds[0].description}
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm whitespace-pre-wrap leading-relaxed wrap-break-word hyphens-auto">
                            {m.payload.content || ""}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col sm:flex-row gap-0.5 sm:gap-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity ml-2 sm:ml-4 bg-(--bg-main) sm:bg-transparent rounded border sm:border-0 border-(--border)">
                        <button
                          onClick={() => editMessage(m.id)}
                          className="p-2 text-gray-500 hover:text-white flex items-center">
                          <Icon name="edit-3" size={16} />
                        </button>
                        <button
                          onClick={() => {
                            fetch(`${activeProfile.url}/messages/${m.id}`, {
                              method: "DELETE",
                            });
                            setProfiles(prev => {
                              const up = [...prev];
                              const currentProf = { ...up[activeIdx] };
                              currentProf.messages =
                                currentProf.messages.filter(
                                  msg => msg.id !== m.id
                                );
                              up[activeIdx] = currentProf;
                              return up;
                            });
                          }}
                          className="p-2 text-gray-500 hover:text-red-500 flex items-center">
                          <Icon name="trash-2" size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messageEndRef} />
            </div>
          )}
        </section>
        {activeProfile && (
          <footer className="p-3 sm:p-4 shrink-0 border-t border-(--border)">
            <div className="max-w-5xl mx-auto">
              <div className="flex gap-4 mb-2 ml-2">
                <button
                  onClick={() => setMode("text")}
                  className={`text-[10px] font-bold uppercase tracking-widest pb-1 border-b-2 transition-all ${
                    mode === "text"
                      ? "text-white border-[#5865f2]"
                      : "text-[#949ba4] border-transparent"
                  }`}>
                  Text
                </button>
                <button
                  onClick={() => setMode("embed")}
                  className={`text-[10px] font-bold uppercase tracking-widest pb-1 border-b-2 transition-all ${
                    mode === "embed"
                      ? "text-white border-[#5865f2]"
                      : "text-[#949ba4] border-transparent"
                  }`}>
                  Embed
                </button>
              </div>
              <div className="input-area rounded-xl p-3 border border-(--border) shadow-lg">
                {mode === "text" ? (
                  <textarea
                    value={inputText}
                    onChange={e => setInputText(e.target.value)}
                    onKeyDown={e =>
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      (e.preventDefault(), sendMessage())
                    }
                    placeholder={`Message ${activeProfile.name}`}
                    className="bg-transparent w-full outline-none text-sm h-10 sm:h-12"
                  />
                ) : (
                  <div className="flex flex-col gap-3">
                    <input
                      placeholder="Title"
                      value={embed.title}
                      onChange={e =>
                        setEmbed({ ...embed, title: e.target.value })
                      }
                      className="bg-transparent border-b border-(--border) pb-2 text-sm outline-none font-semibold text-(--text-header)"
                    />
                    <textarea
                      placeholder="Description"
                      value={embed.description}
                      onChange={e =>
                        setEmbed({ ...embed, description: e.target.value })
                      }
                      className="bg-transparent text-sm outline-none h-20"
                    />
                    <div className="flex items-center gap-3 pt-2 border-t border-(--border) overflow-x-auto">
                      <span className="text-[10px] text-[#949ba4] uppercase font-bold tracking-wide whitespace-nowrap">
                        Sidebar Colour
                      </span>
                      <input
                        type="color"
                        value={embed.color}
                        onChange={e =>
                          setEmbed({ ...embed, color: e.target.value })
                        }
                        className="w-8 h-6 bg-transparent cursor-pointer shrink-0"
                      />
                      <div className="flex gap-2">
                        {(activeProfile.colorHistory || []).map((c, idx) => (
                          <div
                            key={idx}
                            onClick={() => setEmbed({ ...embed, color: c })}
                            className="w-5 h-5 rounded-full cursor-pointer border border-white/10 hover:scale-110 transition-transform shadow-md"
                            style={{ backgroundColor: c }}></div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex justify-end mt-3 pt-2 border-t border-(--border)">
                  <button
                    onClick={sendMessage}
                    disabled={
                      isSending || (mode === "text" && !inputText.trim())
                    }
                    className="flex items-center gap-2 bg-[#5865f2] hover:bg-[#4752c4] px-5 py-2 text-white text-[11px] font-bold rounded-lg transition-all shadow-md disabled:opacity-50">
                    <Icon name="send" size={14} />{" "}
                    <span>{isSending ? "Sending..." : "Send Message"}</span>
                  </button>
                </div>
              </div>
            </div>
          </footer>
        )}
      </main>
    </div>
  );
};

export default App;
