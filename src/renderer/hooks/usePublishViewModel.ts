import { useState, useMemo, useEffect } from "react";
import { PLATFORMS, type PlatformKey } from "../../shared/platforms";

export function usePublishViewModel() {
  // State
  const [filePath, setFilePath] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [category, setCategory] = useState("Entertainment");
  const [coverPath, setCoverPath] = useState("");
  const [publishTime, setPublishTime] = useState("");
  const [collection, setCollection] = useState("");
  const [availablePlaylists, setAvailablePlaylists] = useState<string[]>([]);
  const [localInvisible, setLocalInvisible] = useState(false);
  const [platform, setPlatform] = useState<PlatformKey>("kuaishou");
  const [username, setUsername] = useState("Ksen clean");
  const [avatar, setAvatar] = useState("");

  // Loading statuses
  const [isNavigating, setIsNavigating] = useState(false);
  const [isMounting, setIsMounting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFetchingUser, setIsFetchingUser] = useState(false);

  // Auto-sync specific fields on change
  useEffect(() => {
    // Debounce the auto-sync slightly to avoid spam
    const timer = setTimeout(() => {
      window.crawlWeb.publish.syncForm({
        platform,
        title,
        description,
        tags: tags.split(/[,，、]+/).map((t) => t.trim()).filter(Boolean),
        category,
        coverImage: coverPath,
        publishTime: publishTime || undefined,
        collection: collection || undefined,
        localInvisible
      }).catch(err => console.error("Auto-sync failed:", err));
    }, 300);
    return () => clearTimeout(timer);
  }, [publishTime, localInvisible, platform]);

  // Computed
  const currentConfig = useMemo(() => PLATFORMS[platform], [platform]);
  const canSync = !!(title || description) && !isSyncing;
  const canMount = !!filePath && !isMounting;

  // Actions
  const handleNavigate = async () => {
    setIsNavigating(true);
    try {
      await window.crawlWeb.publish.navigate(currentConfig.url);
      // Automatically fetch user info & playlists after navigating
      setTimeout(() => {
        handleFetchUserInfo().catch(console.error);
      }, 3000);
    } catch (err) {
      console.error("Failed to navigate:", err);
    } finally {
      setIsNavigating(false);
    }
  };

  const handleSelectFile = async () => {
    try {
      const paths = await window.crawlWeb.system.selectFile({
        properties: ["openFile"],
        filters: [{ name: "Videos", extensions: ["mp4", "mkv", "avi", "mov"] }]
      });
      if (paths && paths.length > 0) setFilePath(paths[0]);
    } catch (err) {
      console.error("Failed to select file:", err);
    }
  };

  const handleSelectCover = async () => {
    try {
      const paths = await window.crawlWeb.system.selectFile({
        properties: ["openFile"],
        filters: [{ name: "Images", extensions: ["jpg", "png", "jpeg"] }]
      });
      if (paths && paths.length > 0) setCoverPath(paths[0]);
    } catch (err) {
      console.error("Failed to select cover:", err);
    }
  };

  const handleMountVideo = async () => {
    if (!filePath) return;
    setIsMounting(true);
    try {
      await window.crawlWeb.publish.mountVideo(filePath);
    } catch (err) {
      console.error("Failed to mount video:", err);
    } finally {
      setIsMounting(false);
    }
  };

  const handleSyncForm = async () => {
    setIsSyncing(true);
    try {
      await window.crawlWeb.publish.syncForm({
        platform,
        title,
        description,
        tags: tags.split(/[,，、]+/).map((t) => t.trim()).filter(Boolean),
        category,
        coverImage: coverPath,
        publishTime: publishTime || undefined,
        collection: collection || undefined,
        localInvisible
      });
    } catch (err) {
      console.error("Failed to sync form:", err);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await window.crawlWeb.publish.submit(platform);
    } catch (err) {
      console.error("Failed to submit:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFetchUserInfo = async () => {
    setIsFetchingUser(true);
    try {
      const info = await window.crawlWeb.publish.getUserInfo(platform);
      if (info) {
        if (info.username) setUsername(info.username);
        if (info.avatar) setAvatar(info.avatar);
        if (info.playlists) setAvailablePlaylists(info.playlists);
      }
    } catch (err) {
      console.error("Failed to fetch user info:", err);
    } finally {
      setIsFetchingUser(false);
    }
  };

  const handleGetCookies = async () => {
    try {
      const cookies = await window.crawlWeb.browser.getCookies();
      console.log(`[Browser] Fetched ${cookies.length} cookies`, cookies);
      alert(`Fetched ${cookies.length} cookies. Check DevTools for details.`);
    } catch (err: any) {
      console.error("Failed to get cookies:", err);
      alert(`Error getting cookies: ${err.message}`);
    }
  };

  const handleExecuteJs = async () => {
    try {
      const result = await window.crawlWeb.browser.executeJs<string>("document.title");
      console.log(`[Browser] JS Result:`, result);
      alert(`document.title = ${result}`);
    } catch (err: any) {
      console.error("Failed to execute JS:", err);
      alert(`Error executing JS: ${err.message}`);
    }
  };

  return {
    state: {
      filePath, title, description, tags, category,
      coverPath, publishTime, collection, availablePlaylists, localInvisible, platform,
      username, avatar, isFetchingUser,
      isNavigating, isMounting, isSyncing, isSubmitting
    },
    computed: {
      currentConfig, canSync, canMount
    },
    setters: {
      setTitle, setDescription, setTags, setCategory,
      setPublishTime, setCollection, setLocalInvisible, setPlatform,
      setUsername, setAvatar, setAvailablePlaylists
    },
    actions: {
      handleNavigate, handleSelectFile, handleSelectCover,
      handleMountVideo, handleSyncForm, handleSubmit, handleFetchUserInfo,
      handleGetCookies, handleExecuteJs
    }
  };
}
