"use client";

import {
  Bell,
  Bookmark,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Compass,
  Edit3,
  Globe2,
  Heart,
  Home,
  Images,
  Image as ImageIcon,
  Menu,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Search,
  Send,
  Settings,
  Smile,
  Sparkles,
  ThumbsUp,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Comment, DEFAULT_AVATAR, Person, Post, ReactionType } from "@/lib/data";
import { getSupabase } from "@/lib/supabase/client";
import type { RealtimeChannel, Session, SupabaseClient } from "@supabase/supabase-js";

type PageKey = "feed" | "profile" | "member-profile" | "friends" | "messages" | "saved" | "settings";
type AuthMode = "signin" | "signup";
type ProfileRow = { id: string; display_name: string; username: string | null; avatar_url: string | null; bio?: string; cover_url?: string | null; is_private?: boolean; created_at?: string };
type FriendshipRow = { id: string; requester_id: string; addressee_id: string; status: "pending" | "accepted" | "declined" | "blocked"; created_at: string };
type NotificationRow = { id: string; kind: string; entity_id: string | null; read_at: string | null; created_at: string; profiles: ProfileRow | ProfileRow[] | null };
type FeedRow = {
  id: string;
  content: string;
  image_url: string | null;
  created_at: string;
  author_id: string;
  likes: { user_id: string; reaction: ReactionType }[];
  comments: {
    id: string;
    content: string;
    created_at: string;
    author_id: string;
    profiles: ProfileRow | ProfileRow[] | null;
  }[];
  profiles: ProfileRow | ProfileRow[] | null;
};

function toPerson(relation: ProfileRow | ProfileRow[] | null, fallbackId: string): Person {
  const profile = Array.isArray(relation) ? relation[0] : relation;
  return {
    id: profile?.id || fallbackId,
    name: profile?.display_name || "MahinBook member",
    handle: profile?.username || "member",
    avatar: profile?.avatar_url || DEFAULT_AVATAR,
  };
}

function toPost(row: FeedRow, viewerId: string): Post {
  const comments: Comment[] = (row.comments || []).map((comment) => ({
    id: comment.id,
    text: comment.content,
    time: timeAgo(comment.created_at),
    author: toPerson(comment.profiles, comment.author_id),
  }));
  return {
    id: row.id,
    content: row.content,
    image: row.image_url || undefined,
    author: toPerson(row.profiles, row.author_id),
    time: timeAgo(row.created_at),
    likes: row.likes?.length || 0,
    liked: (row.likes || []).some((like) => like.user_id === viewerId),
    reaction: (row.likes || []).find((like) => like.user_id === viewerId)?.reaction,
    comments,
  };
}

const pageLabels: Record<PageKey, string> = {
  feed: "Your feed",
  profile: "Your profile",
  "member-profile": "Friend profile",
  friends: "Find your people",
  messages: "Messages",
  saved: "Saved moments",
  settings: "Your settings",
};

function timeAgo(value: string) {
  const minutes = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} hr${minutes >= 120 ? "s" : ""} ago`;
  return `${Math.floor(minutes / 1440)} days ago`;
}

export default function SocialApp() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [profilePosts, setProfilePosts] = useState<Post[]>([]);
  const [profilePostCount, setProfilePostCount] = useState(0);
  const [profilePostsLoading, setProfilePostsLoading] = useState(false);
  const [profilePostsLoadingMore, setProfilePostsLoadingMore] = useState(false);
  const profilePostsOffset = useRef(0);
  const activeUserId = useRef<string | null>(null);
  const [profileTab, setProfileTab] = useState<"posts" | "about" | "photos">("posts");
  const [page, setPage] = useState<PageKey>("feed");
  const [profileTarget, setProfileTarget] = useState<string | null>(null);
  const [pendingMessageUser, setPendingMessageUser] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [postMedia, setPostMedia] = useState<File | null>(null);
  const [postVisibility, setPostVisibility] = useState<"public" | "friends" | "private">("public");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [expandedComments, setExpandedComments] = useState<string[]>([]);
  const [savedPosts, setSavedPosts] = useState<string[]>([]);
  const [friendships, setFriendships] = useState<FriendshipRow[]>([]);
  const [suggestedProfiles, setSuggestedProfiles] = useState<ProfileRow[]>([]);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [messageAlerts, setMessageAlerts] = useState(true);
  const [searchProfiles, setSearchProfiles] = useState<ProfileRow[]>([]);
  const [editPost, setEditPost] = useState<Post | null>(null);
  const [editPostText, setEditPostText] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [user, setUser] = useState<{ id: string; email?: string; name: string; avatar?: string } | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [databaseReady, setDatabaseReady] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [busy, setBusy] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const supabase = getSupabase();
  const isConnected = Boolean(supabase);
  const displayPerson: Person = user
    ? {
        id: user.id,
        name: profile?.display_name || user.name,
        handle: profile?.username || user.name.toLowerCase().replace(/[^a-z0-9]+/g, ""),
        avatar: profile?.avatar_url || user.avatar || DEFAULT_AVATAR,
      }
    : { id: "", name: "", handle: "", avatar: DEFAULT_AVATAR };

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2800);
  }, []);

  const loadPosts = useCallback(async () => {
    const client = getSupabase();
    if (!client || !user) {
      setPosts([]);
      return;
    }
    const { data, error: queryError } = await client
      .from("posts")
      .select("id, content, image_url, created_at, author_id, likes(user_id, reaction), comments(id, content, created_at, author_id, profiles!comments_author_id_fkey(id, display_name, username, avatar_url)), profiles!posts_author_id_fkey(id, display_name, username, avatar_url)")
      .order("created_at", { ascending: false })
      .limit(30);

    if (queryError) {
      setError(`Could not load your feed: ${queryError.message}`);
      return;
    }

    setPosts(((data || []) as FeedRow[]).map((row) => toPost(row, user.id)));
    setDatabaseReady(true);
  }, [user]);

  const loadProfilePosts = useCallback(async (append = false) => {
    if (!supabase || !user) {
      setProfilePosts([]);
      setProfilePostCount(0);
      profilePostsOffset.current = 0;
      setProfilePostsLoading(false);
      setProfilePostsLoadingMore(false);
      return;
    }
    const from = append ? profilePostsOffset.current : 0;
    if (append) setProfilePostsLoadingMore(true);
    else setProfilePostsLoading(true);
    const { data, count, error: queryError } = await supabase
      .from("posts")
      .select("id, content, image_url, created_at, author_id, likes(user_id, reaction), comments(id, content, created_at, author_id, profiles!comments_author_id_fkey(id, display_name, username, avatar_url)), profiles!posts_author_id_fkey(id, display_name, username, avatar_url)", { count: "exact" })
      .eq("author_id", user.id)
      .order("created_at", { ascending: false })
      .range(from, from + 29);
    if (queryError) {
      if (activeUserId.current !== user.id) return;
      setError(`Could not load your profile posts: ${queryError.message}`);
      setProfilePostsLoading(false);
      setProfilePostsLoadingMore(false);
      return;
    }
    if (activeUserId.current !== user.id) return;
    const mapped = ((data || []) as FeedRow[]).map((row) => toPost(row, user.id));
    if (append) setProfilePosts((current) => [...current, ...mapped]);
    else setProfilePosts(mapped);
    profilePostsOffset.current = from + mapped.length;
    setProfilePostCount(count || 0);
    setProfilePostsLoading(false);
    setProfilePostsLoadingMore(false);
  }, [supabase, user]);

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }
    let alive = true;
    const applySession = (session: Session | null) => {
      if (!alive) return;
      const sessionUser = session?.user;
      activeUserId.current = sessionUser?.id || null;
      if (!sessionUser) {
        setDatabaseReady(false);
        setProfile(null);
        setPosts([]);
        setProfilePosts([]);
        setProfilePostCount(0);
        profilePostsOffset.current = 0;
        setProfilePostsLoading(false);
        setProfilePostsLoadingMore(false);
        setFriendships([]);
        setSuggestedProfiles([]);
        setNotifications([]);
        setSearchProfiles([]);
      }
      setUser(
        sessionUser
          ? {
              id: sessionUser.id,
              email: sessionUser.email,
              name: sessionUser.user_metadata?.display_name || sessionUser.email?.split("@")[0] || "Your profile",
              avatar: sessionUser.user_metadata?.avatar_url,
            }
          : null,
      );
      setAuthReady(true);
    };
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session);
    });
    void supabase.auth.getSession()
      .then(({ data }) => applySession(data.session))
      .catch(() => {
        if (!alive) return;
        setError("Could not restore your session. Please sign in again.");
        setAuthReady(true);
      });
    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    void loadPosts();
  }, [loadPosts]);

  useEffect(() => {
    if (page === "profile") void loadProfilePosts();
  }, [loadProfilePosts, page]);

  useEffect(() => {
    if (!supabase || !user) {
      setIsPrivate(false);
      return;
    }
    let alive = true;
    supabase
      .from("profiles")
      .select("id, display_name, username, avatar_url, bio, cover_url, is_private, created_at")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data, error: profileError }) => {
        if (!alive) return;
        if (profileError) {
          setError(`Could not load your privacy settings: ${profileError.message}`);
          return;
        }
        setProfile(data as ProfileRow | null);
        setIsPrivate(data?.is_private ?? false);
      });
    return () => {
      alive = false;
    };
  }, [supabase, user]);

  async function uploadImage(file: File, folder: "posts" | "avatars" | "covers") {
    if (!supabase || !user) throw new Error("Sign in before uploading media.");
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowed.includes(file.type)) throw new Error("Choose a JPG, PNG, WebP, or GIF image.");
    if (file.size > 8 * 1024 * 1024) throw new Error("Images must be 8 MB or smaller.");
    const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${user.id}/${folder}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from("mahinbook-media").upload(path, file, {
      contentType: file.type,
      cacheControl: "3600",
      upsert: false,
    });
    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
    return supabase.storage.from("mahinbook-media").getPublicUrl(path).data.publicUrl;
  }

  async function sendFriendRequest(profileId: string) {
    if (!supabase || !user) {
      setAuthMode("signin");
      return;
    }
    const { error: requestError } = await supabase.rpc("send_friend_request", { target_user: profileId });
    if (requestError) {
      setError(`Could not send friend request: ${requestError.message}`);
      return;
    }
    await loadFriendships();
    showNotice("Friend request sent.");
  }

  async function respondFriendRequest(friendshipId: string, status: "accepted" | "declined") {
    if (!supabase) return;
    const { error: updateError } = await supabase.from("friendships").update({ status, updated_at: new Date().toISOString() }).eq("id", friendshipId);
    if (updateError) {
      setError(`Could not ${status === "accepted" ? "accept" : "decline"} the request: ${updateError.message}`);
      return;
    }
    await loadFriendships();
    showNotice(status === "accepted" ? "You’re friends now." : "Friend request declined.");
  }

  async function blockUser(profileId: string) {
    if (!supabase) return;
    if (!window.confirm("Block this person? They won’t be able to see your profile, posts, or messages.")) return;
    const { error: blockError } = await supabase.rpc("block_user", { target_user: profileId });
    if (blockError) {
      setError(`Could not block this person: ${blockError.message}`);
      return;
    }
    await Promise.all([loadFriendships(), loadPosts()]);
    showNotice("This person is blocked.");
  }

  async function unblockUser(profileId: string) {
    if (!supabase) return;
    const { error: unblockError } = await supabase.rpc("unblock_user", { target_user: profileId });
    if (unblockError) {
      setError(`Could not unblock this person: ${unblockError.message}`);
      return;
    }
    await loadFriendships();
    showNotice("This person has been unblocked.");
  }

  async function markNotificationsRead() {
    if (!supabase || !user) return;
    const unreadIds = notifications.filter((notification) => !notification.read_at).map((notification) => notification.id);
    if (!unreadIds.length) return;
    const { error: updateError } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).in("id", unreadIds);
    if (updateError) {
      setError(`Could not mark notifications as read: ${updateError.message}`);
      return;
    }
    await loadNotifications();
  }

  const loadFriendships = useCallback(async () => {
    if (!supabase || !user) {
      setFriendships([]);
      return;
    }
    const { data, error: loadError } = await supabase
      .from("friendships")
      .select("id, requester_id, addressee_id, status, created_at")
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
      .order("created_at", { ascending: false });
    if (loadError) {
      setError(`Could not load friends: ${loadError.message}`);
      return;
    }
    setFriendships((data || []) as FriendshipRow[]);
  }, [supabase, user]);

  const loadNotifications = useCallback(async () => {
    if (!supabase || !user) {
      setNotifications([]);
      return;
    }
    const { data, error: loadError } = await supabase
      .from("notifications")
      .select("id, kind, entity_id, read_at, created_at, profiles!notifications_actor_id_fkey(id, display_name, username, avatar_url)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(30);
    if (loadError) {
      setError(`Could not load notifications: ${loadError.message}`);
      return;
    }
    setNotifications((data || []) as NotificationRow[]);
  }, [supabase, user]);

  useEffect(() => {
    void loadFriendships();
  }, [loadFriendships]);

  useEffect(() => {
    if (!supabase || !user) {
      setSuggestedProfiles([]);
      return;
    }
    let alive = true;
    const related = new Set(friendships.flatMap((item) => [item.requester_id, item.addressee_id]));
    supabase.from("profiles").select("id, display_name, username, avatar_url, bio").neq("id", user.id).limit(12).then(({ data, error: loadError }) => {
      if (!alive) return;
      if (loadError) setError(`Could not load people suggestions: ${loadError.message}`);
      else setSuggestedProfiles((data || []).filter((item) => !related.has(item.id)).slice(0, 3) as ProfileRow[]);
    });
    return () => { alive = false; };
  }, [friendships, supabase, user]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    setMessageAlerts(window.localStorage.getItem("mahinbook-message-alerts") !== "false");
  }, []);

  useEffect(() => {
    if (!supabase || !user || search.trim().length < 2) {
      setSearchProfiles([]);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(async () => {
      const term = search.trim().replaceAll("%", "\\%").replaceAll("_", "\\_");
      const { data, error: searchError } = await supabase
        .from("profiles")
        .select("id, display_name, username, avatar_url, bio")
        .or(`display_name.ilike.%${term}%,username.ilike.%${term}%`)
        .neq("id", user.id)
        .limit(8);
      if (!alive) return;
      if (searchError) setError(`Search failed: ${searchError.message}`);
      else setSearchProfiles((data || []) as ProfileRow[]);
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [search, supabase, user]);

  useEffect(() => {
    if (!supabase || !user) return;
    const channel = supabase
      .channel("mahinbook-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, () => {
        void loadPosts();
        if (page === "profile") void loadProfilePosts();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "likes" }, () => {
        void loadPosts();
        if (page === "profile") void loadProfilePosts();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, () => {
        void loadPosts();
        if (page === "profile") void loadProfilePosts();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, () => void loadFriendships())
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, () => void loadNotifications())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadFriendships, loadNotifications, loadPosts, loadProfilePosts, page, supabase, user]);

  const visiblePosts = useMemo(() => {
    const filtered = page === "saved" ? posts.filter((post) => savedPosts.includes(post.id)) : posts;
    if (!search.trim()) return filtered;
    const normalized = search.toLowerCase();
    return filtered.filter(
      (post) =>
        post.content.toLowerCase().includes(normalized) ||
        post.author.name.toLowerCase().includes(normalized) ||
        post.author.handle.toLowerCase().includes(normalized),
    );
  }, [page, posts, savedPosts, search]);

  function renderPostCard(post: Post) {
    return (
      <PostCard
        key={post.id}
        post={post}
        currentUser={displayPerson}
        expanded={expandedComments.includes(post.id)}
        commentDraft={commentDrafts[post.id] || ""}
        saved={savedPosts.includes(post.id)}
        onReact={(reaction) => void toggleReaction(post, reaction)}
        onCommentDraft={(value) => setCommentDrafts((items) => ({ ...items, [post.id]: value }))}
        onSubmitComment={(event) => void submitComment(event, post)}
        onToggleComments={() => setExpandedComments((items) => items.includes(post.id) ? items.filter((id) => id !== post.id) : [...items, post.id])}
        onSave={() => setSavedPosts((items) => items.includes(post.id) ? items.filter((id) => id !== post.id) : [...items, post.id])}
        onMore={() => showNotice("More post options are coming soon.")}
        canManage={post.author.id === user?.id}
        onEdit={() => { setEditPost(post); setEditPostText(post.content); }}
        onDelete={() => void deletePost(post)}
        onDeleteComment={(commentId) => void deleteComment(commentId)}
        onShare={() => {
          if (navigator.clipboard) void navigator.clipboard.writeText(window.location.href);
          showNotice("Link copied — share the good.");
        }}
      />
    );
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setError("Sign-in is unavailable because Supabase is not configured.");
      return;
    }
    setBusy(true);
    setError("");
    const response =
      authMode === "signup"
        ? await supabase.auth.signUp({
            email: authEmail,
            password: authPassword,
            options: { data: { display_name: authName.trim() || authEmail.split("@")[0] } },
          })
        : await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
    setBusy(false);
    if (response.error) {
      setError(response.error.message);
      return;
    }
    if (authMode === "signup" && !response.data.session) {
      setAuthMode("signin");
      setAuthPassword("");
      setError("Check your email to finish creating your account, then sign in.");
      return;
    }
    setAuthMode("signin");
    setAuthPassword("");
    showNotice(authMode === "signup" ? "Welcome to the neighborhood!" : "Welcome back!");
  }

  async function signInWith(provider: "google") {
    if (!supabase) {
      setError("Sign-in is unavailable because Supabase is not configured.");
      return;
    }
    setError("");
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (authError) setError(authError.message);
  }

  async function signOut() {
    if (!supabase) return;
    const { error: authError } = await supabase.auth.signOut();
    if (authError) setError(authError.message);
    else showNotice("You’re signed out.");
  }

  async function togglePrivacy() {
    if (supabase && !user) {
      setAuthMode("signin");
      return;
    }
    const nextValue = !isPrivate;
    if (supabase && user) {
      const { error: updateError } = await supabase.from("profiles").update({ is_private: nextValue }).eq("id", user.id);
      if (updateError) {
        setError(`Could not update your privacy settings: ${updateError.message}`);
        return;
      }
    }
    setIsPrivate(nextValue);
    setProfile((current) => current ? { ...current, is_private: nextValue } : current);
    showNotice(nextValue ? "Your profile is now private." : "Your profile is now public.");
  }

  async function deleteAccount() {
    if (!supabase || !user) {
      setAuthMode("signin");
      return;
    }
    if (!window.confirm("Permanently delete your account, profile, posts, and associated community data? This can’t be undone.")) return;
    setBusy(true);
    try {
      const bucket = supabase.storage.from("mahinbook-media");
      const mediaPaths: string[] = [];
      for (const folder of ["posts", "avatars", "covers"]) {
        let offset = 0;
        while (true) {
          const { data, error: listError } = await bucket.list(`${user.id}/${folder}`, { limit: 1000, offset });
          if (listError) throw new Error(`Could not list uploaded media: ${listError.message}`);
          mediaPaths.push(...(data || []).map((file) => `${user.id}/${folder}/${file.name}`));
          if (!data || data.length < 1000) break;
          offset += data.length;
        }
      }
      for (let start = 0; start < mediaPaths.length; start += 100) {
        const { error: mediaError } = await bucket.remove(mediaPaths.slice(start, start + 100));
        if (mediaError) throw new Error(`Could not remove uploaded media: ${mediaError.message}`);
      }
      const { error: deleteError } = await supabase.rpc("delete_my_account");
      if (deleteError) throw new Error(`Could not delete your account: ${deleteError.message}`);
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError) throw new Error(`Your account was deleted, but this device could not sign out: ${signOutError.message}`);
      setUser(null);
      setIsPrivate(false);
      setPosts([]);
      setPage("feed");
      showNotice("Your account and associated data have been deleted.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete your account.");
    } finally {
      setBusy(false);
    }
  }

  async function createPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim()) return;
    if (supabase && !user) {
      setError("Sign in to share a post with your community.");
      setAuthMode("signin");
      return;
    }
    if (supabase && user) {
      setBusy(true);
      let imageUrl: string | undefined;
      if (postMedia) {
        try {
          imageUrl = await uploadImage(postMedia, "posts");
        } catch (uploadError) {
          setBusy(false);
          setError(uploadError instanceof Error ? uploadError.message : "Could not upload this image.");
          return;
        }
      }
      const { error: insertError } = await supabase.from("posts").insert({
        author_id: user.id,
        content: draft.trim(),
        image_url: imageUrl || null,
        visibility: postVisibility,
      });
      setBusy(false);
      if (insertError) {
        setError(`Could not share your post: ${insertError.message}`);
        return;
      }
      await loadPosts();
    } else {
      setPosts((current) => [
        {
          id: `local-${Date.now()}`,
          author: displayPerson,
          time: "just now",
          content: draft.trim(),
          image: postMedia ? URL.createObjectURL(postMedia) : undefined,
          likes: 0,
          comments: [],
          liked: false,
        },
        ...current,
      ]);
    }
    setDraft("");
    setPostMedia(null);
    setPostVisibility("public");
    setComposerOpen(false);
    showNotice("Your moment is out in the world.");
  }

  async function toggleReaction(post: Post, reaction: ReactionType) {
    if (supabase && !user) {
      setAuthMode("signin");
      setError("Sign in to join the conversation.");
      return;
    }
    if (supabase && user && !post.id.startsWith("local-")) {
      const result = post.reaction === reaction
        ? await supabase.from("likes").delete().eq("post_id", post.id).eq("user_id", user.id)
        : await supabase.from("likes").upsert({ post_id: post.id, user_id: user.id, reaction }, { onConflict: "post_id,user_id" });
      if (result.error) {
        setError(`Could not update your reaction: ${result.error.message}`);
        return;
      }
      await loadPosts();
      if (page === "profile") await loadProfilePosts();
      return;
    }
    setPosts((items) =>
      items.map((item) =>
        item.id === post.id
          ? { ...item, liked: post.reaction !== reaction, reaction: post.reaction === reaction ? undefined : reaction }
          : item,
      ),
    );
  }

  async function submitComment(event: FormEvent<HTMLFormElement>, post: Post) {
    event.preventDefault();
    const text = (commentDrafts[post.id] || "").trim();
    if (!text) return;
    if (supabase && !user) {
      setAuthMode("signin");
      setError("Sign in to leave a comment.");
      return;
    }
    if (supabase && user && !post.id.startsWith("local-")) {
      const { error: insertError } = await supabase.from("comments").insert({
        post_id: post.id,
        author_id: user.id,
        content: text,
      });
      if (insertError) {
        setError(`Could not add your comment: ${insertError.message}`);
        return;
      }
      await loadPosts();
      if (page === "profile") await loadProfilePosts();
    } else {
      const comment: Comment = {
        id: `comment-${Date.now()}`,
        author: displayPerson,
        text,
        time: "now",
      };
      setPosts((items) => items.map((item) => (item.id === post.id ? { ...item, comments: [...item.comments, comment] } : item)));
    }
    setCommentDrafts((items) => ({ ...items, [post.id]: "" }));
    setExpandedComments((items) => (items.includes(post.id) ? items : [...items, post.id]));
  }

  async function deleteComment(commentId: string) {
    if (!supabase) return;
    const { error: deleteError } = await supabase.from("comments").delete().eq("id", commentId);
    if (deleteError) {
      setError(`Could not delete your comment: ${deleteError.message}`);
      return;
    }
    await loadPosts();
    if (page === "profile") await loadProfilePosts();
  }

  async function savePostEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !editPost || !editPostText.trim()) return;
    const { error: updateError } = await supabase.from("posts").update({ content: editPostText.trim(), updated_at: new Date().toISOString() }).eq("id", editPost.id);
    if (updateError) {
      setError(`Could not update your post: ${updateError.message}`);
      return;
    }
    setEditPost(null);
    await loadPosts();
    if (page === "profile") await loadProfilePosts();
    showNotice("Your post has been updated.");
  }

  async function deletePost(post: Post) {
    if (!supabase || !window.confirm("Delete this post and its comments? This can’t be undone.")) return;
    const { error: deleteError } = await supabase.from("posts").delete().eq("id", post.id);
    if (deleteError) {
      setError(`Could not delete your post: ${deleteError.message}`);
      return;
    }
    await loadPosts();
    if (page === "profile") await loadProfilePosts();
    showNotice("Post deleted.");
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>, values: { display_name: string; username: string; bio: string }, avatar: File | null, cover: File | null) {
    event.preventDefault();
    if (!supabase || !user) return;
    const username = values.username.trim().toLowerCase().replace(/^@/, "");
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      setError("Your username must be 3–24 characters using letters, numbers, and underscores.");
      return;
    }
    setBusy(true);
    try {
      const [avatarUrl, coverUrl] = await Promise.all([
        avatar ? uploadImage(avatar, "avatars") : Promise.resolve(profile?.avatar_url || null),
        cover ? uploadImage(cover, "covers") : Promise.resolve(profile?.cover_url || null),
      ]);
      const updates = {
        display_name: values.display_name.trim(),
        username,
        bio: values.bio.trim(),
        avatar_url: avatarUrl,
        cover_url: coverUrl,
        updated_at: new Date().toISOString(),
      };
      const { error: updateError } = await supabase.from("profiles").update(updates).eq("id", user.id);
      if (updateError) throw new Error(updateError.message);
      setProfile((current) => current ? { ...current, ...updates } : { id: user.id, ...updates });
      showNotice("Your profile is up to date.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save your profile.");
    } finally {
      setBusy(false);
    }
  }

  function navTo(next: PageKey) {
    setPage(next);
    setMobileMenuOpen(false);
    setError("");
    if (next === "profile") window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#profile`);
    else if (window.location.hash === "#profile") window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }

  useEffect(() => {
    if (authReady && user && window.location.hash === "#profile") setPage("profile");
  }, [authReady, user]);

  if (!authReady) {
    return <main className="auth-gate"><p role="status">Restoring your session…</p></main>;
  }

  if (!user) {
    return (
      <main className="auth-gate">
        <section className="auth-modal auth-gate-card" role="dialog" aria-modal="true" aria-labelledby="auth-title">
          <span className="auth-mark"><span className="brand-mark"><span /></span></span>
          <p className="eyebrow">A LITTLE MORE TOGETHER</p>
          <h2 id="auth-title">{authMode === "signup" ? "Come on in." : "Good to see you."}</h2>
          <p className="auth-copy">{authMode === "signup" ? "Make a little space for your people." : "Sign in to see your community."}</p>
          {!supabase && <p className="auth-error" role="alert">Sign-in is unavailable because Supabase is not configured.</p>}
          <div className="oauth-row auth-oauth-single">
            <button type="button" disabled={!supabase || busy} onClick={() => void signInWith("google")}><span className="google-g">G</span> Continue with Google</button>
          </div>
          <div className="or-divider"><span /> or with email <span /></div>
          <form onSubmit={submitAuth} className="auth-form">
            {authMode === "signup" && <label>Your name<input value={authName} onChange={(event) => setAuthName(event.target.value)} placeholder="What should we call you?" required /></label>}
            <label>Email address<input type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" required /></label>
            <label>Password<input type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="At least 6 characters" autoComplete={authMode === "signup" ? "new-password" : "current-password"} minLength={6} required /></label>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="auth-submit" type="submit" disabled={busy || !supabase}>{busy ? "One moment…" : authMode === "signup" ? "Create your account" : "Sign in"} <ChevronRight size={17} /></button>
          </form>
          <p className="auth-switch">{authMode === "signup" ? "Already have an account?" : "New here?"} <button type="button" onClick={() => { setError(""); setAuthPassword(""); setAuthMode(authMode === "signup" ? "signin" : "signup"); }}>{authMode === "signup" ? "Sign in" : "Create an account"}</button></p>
          <small className="auth-privacy">Your session will stay signed in on this device until you sign out.</small>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <button className="mobile-menu icon-button" aria-label="Open menu" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            <Menu size={21} />
          </button>
          <button className="brand" aria-label="MahinBook home" onClick={() => navTo("feed")}>
            <span className="brand-mark"><span /></span>
            <span className="brand-word">mahin<span>book</span></span>
          </button>
          <label className="search-box">
            <Search size={18} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people and moments" aria-label="Search people and moments" />
            {search && <button className="search-clear" onClick={() => setSearch("")} aria-label="Clear search"><X size={15} /></button>}
          </label>
          <div className="top-actions">
            <button className="top-action" aria-label="Messages" onClick={() => navTo("messages")}><MessageCircle size={19} /><span className="notification-dot" /></button>
            <div className="notification-control">
              <button className="top-action" aria-label={`Notifications${notifications.filter((item) => !item.read_at && (messageAlerts || item.kind !== "message")).length ? `, ${notifications.filter((item) => !item.read_at && (messageAlerts || item.kind !== "message")).length} unread` : ""}`} onClick={() => {
                if (!user) { setAuthMode("signin"); return; }
                setNotificationsOpen((open) => !open);
                void markNotificationsRead();
              }}><Bell size={19} />{notifications.some((item) => !item.read_at && (messageAlerts || item.kind !== "message")) && <span className="notification-dot" />}</button>
              {notificationsOpen && <NotificationsPanel notifications={notifications.filter((item) => messageAlerts || item.kind !== "message")} onClose={() => setNotificationsOpen(false)} onRefresh={() => void loadNotifications()} />}
            </div>
          <button className="account-chip" onClick={() => navTo("profile")} title="Open your profile">
            <img src={displayPerson.avatar} alt="" />
            <span>{displayPerson.name.split(" ")[0]}</span>
            <ChevronDown size={15} />
            </button>
          </div>
        </div>
      </header>

      {mobileMenuOpen && <button className="mobile-scrim" aria-label="Close menu" onClick={() => setMobileMenuOpen(false)} />}
      <div className="page-grid">
        <aside className={`left-rail ${mobileMenuOpen ? "left-rail-open" : ""}`}>
          <div className="profile-mini">
            <div className="profile-cover" style={profile?.cover_url ? { backgroundImage: `linear-gradient(0deg, rgba(30,48,40,.12), rgba(30,48,40,.12)), url("${profile.cover_url}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined} />
            <img className="profile-avatar" src={displayPerson.avatar} alt="" />
            <strong>{displayPerson.name}</strong>
            <span>@{displayPerson.handle}</span>
            <div className="profile-stats">
              <div><strong>{friendships.filter((item) => item.status === "accepted").length}</strong><span>friends</span></div>
              <i />
              <div><strong>{posts.filter((item) => item.author.id === user?.id).length}</strong><span>moments</span></div>
            </div>
            <button className="profile-view-link" onClick={() => navTo("profile")}>View your profile <ChevronRight size={14} /></button>
          </div>
          <nav className="main-nav" aria-label="Main navigation">
            <NavItem icon={<Home size={19} />} label="Home feed" active={page === "feed"} onClick={() => navTo("feed")} />
            <NavItem icon={<UserRound size={19} />} label="My profile" active={page === "profile"} onClick={() => navTo("profile")} />
              <NavItem icon={<Users size={19} />} label="Friends" badge={(() => {
                const incomingCount = friendships.filter((item) => item.status === "pending" && item.addressee_id === user?.id).length;
                return incomingCount ? String(incomingCount) : undefined;
              })()} active={page === "friends"} onClick={() => navTo("friends")} />
              <NavItem icon={<MessageSquare size={19} />} label="Messages" active={page === "messages"} onClick={() => navTo("messages")} />
            <NavItem icon={<Bookmark size={19} />} label="Saved moments" active={page === "saved"} onClick={() => navTo("saved")} />
            <NavItem icon={<Settings size={19} />} label="Settings" active={page === "settings"} onClick={() => navTo("settings")} />
          </nav>
          <div className="rail-note">
            <Sparkles size={16} />
            <p>A little more meaningful, a little more together.</p>
          </div>
          <div className="rail-footer"><span>About</span><span>Privacy</span><span>Community</span><span>© {new Date().getFullYear()} MahinBook</span></div>
        </aside>

        <section className="feed-column">
          {page !== "profile" && <div className="welcome-row">
            <div>
              <p className="eyebrow">YOUR COMMUNITY</p>
              <h1>{pageLabels[page]}<span className="title-sparkle">✳</span></h1>
              <p className="welcome-subtitle">{page === "feed" ? "Good things are happening around you." : getPageSubtitle(page)}</p>
            </div>
            <button className="outline-pill" onClick={() => showNotice("You’re seeing the latest moments.")}><Compass size={16} /> Explore</button>
          </div>}

          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}><X size={16} /></button>
            </div>
          )}

          {page === "profile" && (
            <ProfilePage
              profile={profile}
              person={displayPerson}
              friendCount={friendships.filter((item) => item.status === "accepted").length}
              postCount={profilePostCount}
              posts={profilePosts}
              loading={profilePostsLoading}
              loadingMore={profilePostsLoadingMore}
              hasMore={profilePosts.length < profilePostCount}
              tab={profileTab}
              onTab={setProfileTab}
              onEdit={() => navTo("settings")}
              onCreatePost={() => { navTo("feed"); setComposerOpen(true); }}
              onLoadMore={() => void loadProfilePosts(true)}
              renderPost={renderPostCard}
            />
          )}
          {page === "member-profile" && profileTarget && <FriendProfilePage supabase={supabase} userId={profileTarget} onMessage={() => { setPendingMessageUser(profileTarget); navTo("messages"); }} onBack={() => navTo("friends")} />}

          {page === "feed" && (
            <>
              <form className="composer-card" onSubmit={createPost}>
                <div className="composer-top">
                  <img src={displayPerson.avatar} alt="" />
                  <button type="button" className="composer-placeholder" onClick={() => setComposerOpen(true)}>What’s on your mind, {displayPerson.name.split(" ")[0]}?</button>
                </div>
                {composerOpen && (
                  <div className="composer-editor">
                    <textarea autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Share a little moment with your people..." rows={3} maxLength={2000} />
                    <span className="character-count">{draft.length}/2000</span>
                  </div>
                )}
                <div className="composer-bottom">
                  <div className="composer-tools">
                    <label className="composer-file-button"><ImageIcon size={18} /><span>{postMedia ? "Change photo" : "Photo"}</span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setPostMedia(event.target.files?.[0] || null)} /></label>
                    <button type="button" onClick={() => showNotice("Add a feeling to your next moment.")}><Smile size={18} /><span>Feeling</span></button>
                    <label className="visibility-select"><Globe2 size={17} /><select aria-label="Post audience" value={postVisibility} onChange={(event) => setPostVisibility(event.target.value as "public" | "friends" | "private")}><option value="public">Public</option><option value="friends">Friends</option><option value="private">Only me</option></select></label>
                  </div>
                  {postMedia && <span className="selected-media">{postMedia.name}<button type="button" aria-label="Remove selected photo" onClick={() => setPostMedia(null)}><X size={13} /></button></span>}
                  {composerOpen ? (
                    <div className="composer-submit">
                      <button className="cancel-button" type="button" onClick={() => { setComposerOpen(false); setDraft(""); }}>Cancel</button>
                      <button className="share-button" type="submit" disabled={!draft.trim() || busy}>{busy ? "Sharing…" : "Share moment"} <Send size={14} /></button>
                    </div>
                  ) : (
                    <button type="button" className="share-button start-post" onClick={() => setComposerOpen(true)}>Create a moment <span>+</span></button>
                  )}
                </div>
              </form>

              {searchProfiles.length > 0 && (
                <section className="search-results">
                  <div className="side-heading"><div><strong>People</strong><span>Matching profiles</span></div></div>
                  {searchProfiles.map((result) => {
                    const relation = friendships.find((friendship) => friendship.requester_id === result.id || friendship.addressee_id === result.id);
                    return <div className="search-person" key={result.id}><img src={result.avatar_url || DEFAULT_AVATAR} alt="" /><button className="search-profile-open" onClick={() => { setProfileTarget(result.id); navTo("member-profile"); }}><strong>{result.display_name}</strong><small>@{result.username || "member"}</small></button>{relation?.status === "accepted" ? <small>Friends</small> : relation?.status === "pending" && relation.requester_id === user?.id ? <small>Request sent</small> : relation?.status === "pending" ? <><button onClick={() => void respondFriendRequest(relation.id, "accepted")}>Accept</button><button className="secondary" onClick={() => void respondFriendRequest(relation.id, "declined")}>Decline</button></> : relation?.status === "blocked" ? <small>Unavailable</small> : <button onClick={() => void sendFriendRequest(result.id)}>Add friend</button>}</div>;
                  })}
                </section>
              )}
              <div className="feed-sort"><span>{search ? `Results for “${search}”` : "Your people, lately"}</span><button onClick={() => showNotice("Feed is sorted by newest first.")}>Most recent <ChevronDown size={15} /></button></div>
              <div className="posts-list">
                {supabase && user && !databaseReady ? (
                  <div className="empty-state"><span><Sparkles size={21} /></span><strong>Gathering your people’s moments</strong><p>Your Supabase feed is loading.</p></div>
                ) : visiblePosts.length ? visiblePosts.map(renderPostCard) : <EmptyState title="No moments to show yet" text={search ? "Try another name or search for something different." : "Be the first to share a moment with your community."} />}
              </div>
            </>
          )}

          {page === "friends" && <FriendsPanel supabase={supabase} user={user} friendships={friendships} onReload={() => void loadFriendships()} onSend={sendFriendRequest} onRespond={respondFriendRequest} onBlock={blockUser} onUnblock={unblockUser} onSignIn={() => setAuthMode("signin")} onViewProfile={(id) => { setProfileTarget(id); navTo("member-profile"); }} />}
          {page === "messages" && <MessagesPanel supabase={supabase} user={user} friendships={friendships} currentUser={displayPerson} openWithUserId={pendingMessageUser} onOpenedUser={() => setPendingMessageUser(null)} onBlock={blockUser} onSignIn={() => setAuthMode("signin")} onError={setError} />}
          {page === "saved" && (
            <>
              <div className="saved-intro"><Bookmark size={18} /><span>Your saved moments are just for you.</span></div>
              <div className="posts-list">
                {visiblePosts.length ? visiblePosts.map(renderPostCard) : <EmptyState title="Save a moment for later" text="Tap the bookmark on any post and it’ll be waiting here." />}
              </div>
            </>
          )}
          {page === "settings" && <SettingsPanel user={user} profile={profile} isConnected={isConnected} databaseReady={databaseReady} isPrivate={isPrivate} messageAlerts={messageAlerts} busy={busy} onToggleMessageAlerts={() => { const next = !messageAlerts; setMessageAlerts(next); window.localStorage.setItem("mahinbook-message-alerts", String(next)); }} onSignIn={() => setAuthMode("signin")} onSignOut={() => void signOut()} onTogglePrivacy={() => void togglePrivacy()} onDeleteAccount={() => void deleteAccount()} onSaveProfile={saveProfile} />}

          {page === "feed" && <div className="feed-end"><span /> You’re all caught up <span /></div>}
        </section>

        <aside className="right-rail">
          <section className="side-section">
            <div className="side-heading"><div><strong>People you may know</strong><span>A few friendly faces</span></div><button aria-label="See all suggestions" onClick={() => navTo("friends")}><ChevronRight size={17} /></button></div>
            <div className="suggestion-list">
              {suggestedProfiles.map((person) => (
                <div className="suggestion" key={person.id}>
                  <img src={person.avatar_url || DEFAULT_AVATAR} alt="" />
                  <div className="suggestion-info"><strong>{person.display_name}</strong><span>@{person.username || "member"}</span></div>
                  <button className="add-friend" aria-label={`Add ${person.display_name}`} onClick={() => user ? void sendFriendRequest(person.id) : setAuthMode("signin")}>+</button>
                </div>
              ))}
              {!suggestedProfiles.length && <p className="muted-copy">{user ? "No new people to suggest yet." : "Sign in to find people you may know."}</p>}
            </div>
            <button className="see-all-link" onClick={() => navTo("friends")}>See all suggestions <ChevronRight size={14} /></button>
          </section>
        </aside>
      </div>

      {notice && <div className="toast"><span className="toast-check"><Check size={14} /></span>{notice}</div>}
      {editPost && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditPost(null); }}>
        <form className="edit-post-modal" onSubmit={(event) => void savePostEdit(event)}>
          <button type="button" className="modal-close" aria-label="Close" onClick={() => setEditPost(null)}><X size={18} /></button>
          <h2>Edit your post</h2>
          <textarea value={editPostText} onChange={(event) => setEditPostText(event.target.value)} maxLength={2000} rows={6} required />
          <button className="auth-submit" disabled={busy || !editPostText.trim()}>{busy ? "Saving…" : "Save changes"} <Check size={15} /></button>
        </form>
      </div>}
    </main>
  );
}

function ProfilePage({ profile, person, friendCount, postCount, posts, loading, loadingMore, hasMore, tab, onTab, onEdit, onCreatePost, onLoadMore, renderPost }: {
  profile: ProfileRow | null;
  person: Person;
  friendCount: number;
  postCount: number;
  posts: Post[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  tab: "posts" | "about" | "photos";
  onTab: (tab: "posts" | "about" | "photos") => void;
  onEdit: () => void;
  onCreatePost: () => void;
  onLoadMore: () => void;
  renderPost: (post: Post) => React.ReactNode;
}) {
  const photos = posts.filter((post) => post.image);
  const completionFields = [profile?.display_name, profile?.username, profile?.bio, profile?.avatar_url, profile?.cover_url];
  const completion = Math.round((completionFields.filter(Boolean).length / completionFields.length) * 100);
  const joined = profile?.created_at
    ? new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(profile.created_at))
    : null;

  return (
    <div className="profile-page">
      <section className="profile-hero-card">
        <div className="profile-hero-cover" style={profile?.cover_url ? { backgroundImage: `linear-gradient(100deg, rgba(20,49,38,.16), rgba(20,49,38,.02)), url("${profile.cover_url}")` } : undefined}>
          {!profile?.cover_url && <><span className="profile-cover-orb profile-cover-orb-one" /><span className="profile-cover-orb profile-cover-orb-two" /><span className="profile-cover-wordmark">MAHINBOOK <i>·</i> YOUR SPACE</span></>}
          <button className="profile-cover-edit" onClick={onEdit}><Camera size={15} /> Customize cover</button>
        </div>
        <div className="profile-identity">
          <img className="profile-hero-avatar" src={person.avatar} alt={`${person.name} profile`} />
          <div className="profile-identity-copy">
            <div className="profile-name-line"><h1>{person.name}</h1>{profile?.is_private && <span className="profile-private-tag">Private</span>}</div>
            <p className="profile-handle">@{person.handle}</p>
            <p className="profile-bio">{profile?.bio?.trim() || "A little space for your story. Add a bio so people can get to know you."}</p>
          </div>
          <div className="profile-actions">
            <button className="profile-edit-button" onClick={onEdit}><Pencil size={15} /> Edit profile</button>
          </div>
        </div>
        <div className="profile-stat-row">
          <div><strong>{friendCount}</strong><span>Friends</span></div>
          <i />
          <div><strong>{postCount}</strong><span>Moments</span></div>
          <span className="profile-stat-note">Your community, your pace</span>
        </div>
        <nav className="profile-tabs" aria-label="Profile sections">
          <button className={tab === "posts" ? "profile-tab-active" : ""} aria-pressed={tab === "posts"} onClick={() => onTab("posts")}>Moments <span>{postCount}</span></button>
          <button className={tab === "about" ? "profile-tab-active" : ""} aria-pressed={tab === "about"} onClick={() => onTab("about")}>About</button>
          <button className={tab === "photos" ? "profile-tab-active" : ""} aria-pressed={tab === "photos"} onClick={() => onTab("photos")}><Images size={15} /> Photos</button>
        </nav>
      </section>

      <div className="profile-layout">
        <section className="profile-main-column">
          {tab === "posts" && <>
            <div className="profile-section-heading"><div><span className="profile-section-kicker">YOUR STORY</span><h2>Latest moments</h2></div><button className="share-button" onClick={onCreatePost}><span>+</span> Create a moment</button></div>
            {loading ? <div className="profile-loading" role="status">Loading your moments…</div> : posts.length ? <><div className="posts-list">{posts.map(renderPost)}</div>{hasMore && <button className="profile-load-more" onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? "Loading older moments…" : "Load older moments"} <ChevronDown size={15} /></button>}</> : <div className="profile-empty"><span className="profile-empty-icon"><Sparkles size={21} /></span><h3>Your story starts here</h3><p>Share a moment, a thought, or a photo with your community.</p><button className="share-button" onClick={onCreatePost}>Create your first moment <ChevronRight size={15} /></button></div>}
          </>}
          {tab === "about" && <section className="profile-detail-card"><span className="profile-section-kicker">THE PERSON BEHIND THE POSTS</span><h2>About {person.name.split(" ")[0]}</h2><p className="profile-about-bio">{profile?.bio?.trim() || "This profile is still getting its introduction. Add a few words about yourself in Edit profile."}</p><div className="profile-detail-list"><div><span className="profile-detail-icon"><UserRound size={16} /></span><span><small>Username</small><strong>@{person.handle}</strong></span></div><div><span className="profile-detail-icon"><Users size={16} /></span><span><small>Friends</small><strong>{friendCount} {friendCount === 1 ? "friend" : "friends"}</strong></span></div><div><span className="profile-detail-icon"><Heart size={16} /></span><span><small>Sharing with</small><strong>{profile?.is_private ? "Friends" : "The community"}</strong></span></div>{joined && <div><span className="profile-detail-icon"><Sparkles size={16} /></span><span><small>Here since</small><strong>{joined}</strong></span></div>}</div><button className="profile-secondary-action" onClick={onEdit}>Complete your profile <ChevronRight size={15} /></button></section>}
          {tab === "photos" && <section className="profile-photos-panel"><div className="profile-section-heading"><div><span className="profile-section-kicker">MOMENTS IN PICTURES</span><h2>Your photos</h2></div></div>{loading ? <div className="profile-loading" role="status">Loading your photos…</div> : photos.length ? <><div className="profile-photo-grid">{photos.map((post) => <a key={post.id} href={post.image} target="_blank" rel="noreferrer" className="profile-photo-tile"><img src={post.image} alt={post.content || "Photo shared on MahinBook"} /><span>{post.content || "Photo moment"}</span></a>)}</div>{hasMore && <button className="profile-load-more" onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? "Loading older moments…" : "Load older moments"} <ChevronDown size={15} /></button>}</> : hasMore ? <div className="profile-empty profile-empty-compact"><span className="profile-empty-icon"><Images size={21} /></span><h3>Looking further back</h3><p>There are older moments to check for photos.</p><button className="profile-secondary-action" onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? "Loading…" : "Load older moments"} <ChevronRight size={15} /></button></div> : <div className="profile-empty profile-empty-compact"><span className="profile-empty-icon"><Images size={21} /></span><h3>No photos yet</h3><p>Photos you share with your moments will appear here.</p><button className="profile-secondary-action" onClick={onCreatePost}>Share a photo <ChevronRight size={15} /></button></div>}</section>}
        </section>

        <aside className="profile-info-column">
          <section className="profile-info-card">
            <div className="profile-info-heading"><span className="profile-info-icon"><UserRound size={16} /></span><h2>About you</h2><button onClick={onEdit} aria-label="Edit profile"><Pencil size={14} /></button></div>
            <p>{profile?.bio?.trim() || "Your bio is a small introduction to the people you meet here."}</p>
            <div className="profile-info-meta"><span className="profile-detail-icon"><Users size={15} /></span><span><strong>{friendCount}</strong> {friendCount === 1 ? "friend" : "friends"}</span></div>
            {joined && <div className="profile-info-meta"><span className="profile-detail-icon"><Sparkles size={15} /></span><span>Joined {joined}</span></div>}
            <button className="profile-secondary-action" onClick={() => onTab("about")}>See full introduction <ChevronRight size={15} /></button>
          </section>
          {completion < 100 && <section className="profile-completion-card"><span className="profile-section-kicker">MAKE IT YOURS</span><div className="profile-completion-title"><strong>Profile strength</strong><span>{completion}%</span></div><div className="profile-progress"><span style={{ width: `${completion}%` }} /></div><p>{completion < 60 ? "Add a photo and a few details so your community can recognize you." : "A cover photo or a few more details will finish your profile."}</p><button onClick={onEdit}>Add profile details <ChevronRight size={14} /></button></section>}
          <div className="profile-privacy-note"><span><Heart size={15} /></span><p>Your profile is {profile?.is_private ? "private to friends" : "visible to your community"}. You can change this anytime in settings.</p></div>
        </aside>
      </div>
    </div>
  );
}

function NavItem({ icon, label, badge, active, onClick }: { icon: React.ReactNode; label: string; badge?: string; active?: boolean; onClick: () => void }) {
  return <button className={`nav-item ${active ? "nav-item-active" : ""}`} onClick={onClick}>{icon}<span>{label}</span>{badge && <small>{badge}</small>}</button>;
}

function PostCard({
  post, currentUser, expanded, commentDraft, saved, canManage, onReact, onCommentDraft, onSubmitComment, onToggleComments, onSave, onMore, onShare, onEdit, onDelete, onDeleteComment,
}: {
  post: Post;
  currentUser: Person;
  expanded: boolean;
  commentDraft: string;
  saved: boolean;
  canManage: boolean;
  onReact: (reaction: ReactionType) => void;
  onCommentDraft: (value: string) => void;
  onSubmitComment: (event: FormEvent<HTMLFormElement>) => void;
  onToggleComments: () => void;
  onSave: () => void;
  onMore: () => void;
  onShare: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDeleteComment: (commentId: string) => void;
}) {
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const reactions: { type: ReactionType; emoji: string; label: string }[] = [
    { type: "like", emoji: "👍", label: "Like" },
    { type: "love", emoji: "❤️", label: "Love" },
    { type: "care", emoji: "🤗", label: "Care" },
    { type: "haha", emoji: "😆", label: "Haha" },
    { type: "wow", emoji: "😮", label: "Wow" },
    { type: "sad", emoji: "😢", label: "Sad" },
    { type: "angry", emoji: "😠", label: "Angry" },
  ];
  const activeReaction = reactions.find((reaction) => reaction.type === post.reaction);
  return (
    <article className="post-card">
      <header className="post-header">
        <img className="post-avatar" src={post.author.avatar} alt="" />
        <div className="post-byline"><strong>{post.author.name}</strong><span>@{post.author.handle} <i>·</i> {post.time}{post.location && <> <i>·</i> <Compass size={12} /> {post.location}</>}</span></div>
        <div className="post-more-wrap">
          <button className="post-more" aria-label="More post options" onClick={() => canManage ? onEdit() : onMore()}>{canManage ? <Pencil size={17} /> : <MoreHorizontal size={21} />}</button>
          {canManage && <button className="post-delete" aria-label="Delete post" onClick={onDelete}><Trash2 size={16} /></button>}
        </div>
      </header>
      <p className="post-copy">{post.content}</p>
      {post.image && <img className="post-image" src={post.image} alt={post.imageAlt || "A moment shared by a friend"} />}
      <div className="post-reactions">
        <div className="reaction-bubble"><ThumbsUp size={12} fill="currentColor" /><Heart size={12} fill="currentColor" /></div>
        <span>{post.likes} people</span>
        <button onClick={onToggleComments}>{post.comments.length} {post.comments.length === 1 ? "comment" : "comments"}</button>
      </div>
      <div className="post-actions">
        <div className="reaction-action-wrap">
          <button className={`post-action ${post.liked ? "action-liked" : ""}`} onClick={() => onReact(post.reaction || "like")}><span className="active-reaction-emoji">{activeReaction?.emoji || <ThumbsUp size={16} fill={post.liked ? "currentColor" : "none"} />}</span> {activeReaction?.label || "Like"}</button>
          <button className="reaction-picker-trigger" aria-label="Choose a reaction" onClick={() => setReactionPickerOpen((open) => !open)}><Smile size={14} /></button>
          {reactionPickerOpen && <div className="reaction-picker">{reactions.map((reaction) => <button key={reaction.type} title={reaction.label} aria-label={reaction.label} onClick={() => { onReact(reaction.type); setReactionPickerOpen(false); }}>{reaction.emoji}</button>)}</div>}
        </div>
        <button className="post-action" onClick={onToggleComments}><MessageCircle size={17} /> Comment</button>
        <button className="post-action" onClick={onShare}><Send size={16} /> Share</button>
        <button className={`save-action ${saved ? "saved" : ""}`} aria-label={saved ? "Remove saved moment" : "Save moment"} onClick={onSave}><Bookmark size={17} fill={saved ? "currentColor" : "none"} /></button>
      </div>
      {expanded && (
        <div className="comments-area">
          {post.comments.slice(-3).map((comment) => (
            <div className="comment-row" key={comment.id}>
              <img src={comment.author.avatar} alt="" />
              <div className="comment-bubble"><strong>{comment.author.name}</strong><p>{comment.text}</p><span>{comment.time}</span></div>
              {comment.author.id === currentUser.id && <button className="comment-delete" aria-label="Delete your comment" onClick={() => onDeleteComment(comment.id)}><Trash2 size={13} /></button>}
            </div>
          ))}
          <form className="comment-form" onSubmit={onSubmitComment}>
            <img src={currentUser.avatar} alt="" />
            <div className="comment-input-wrap"><input value={commentDraft} onChange={(event) => onCommentDraft(event.target.value)} placeholder="Leave a kind note..." aria-label={`Comment on ${post.author.name}'s post`} /><button aria-label="Send comment" disabled={!commentDraft.trim()}><Send size={16} /></button></div>
          </form>
        </div>
      )}
    </article>
  );
}

function FriendsPanel({
  supabase, user, friendships, onReload, onSend, onRespond, onBlock, onUnblock, onSignIn, onViewProfile,
}: {
  supabase: SupabaseClient | null;
  user: { id: string } | null;
  friendships: FriendshipRow[];
  onReload: () => void;
  onSend: (profileId: string) => Promise<void>;
  onRespond: (friendshipId: string, status: "accepted" | "declined") => Promise<void>;
  onBlock: (profileId: string) => Promise<void>;
  onUnblock: (profileId: string) => Promise<void>;
  onSignIn: () => void;
  onViewProfile: (profileId: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<ProfileRow[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase || !user) {
      setSuggestions([]);
      return;
    }
    let alive = true;
    const relatedIds = friendships.flatMap((row) => [row.requester_id, row.addressee_id]);
    supabase.from("profiles").select("id, display_name, username, avatar_url, bio").neq("id", user.id).limit(40).then(({ data, error: loadError }) => {
      if (!alive) return;
      if (!loadError) setSuggestions((data || []).filter((person) => !relatedIds.includes(person.id)) as ProfileRow[]);
    });
    return () => { alive = false; };
  }, [friendships, supabase, user]);

  const incoming = friendships.filter((row) => row.status === "pending" && row.addressee_id === user?.id);
  const outgoing = friendships.filter((row) => row.status === "pending" && row.requester_id === user?.id);
  const friends = friendships.filter((row) => row.status === "accepted");
  const blocked = friendships.filter((row) => row.status === "blocked");

  async function action(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
      onReload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel-card friends-panel">
      <div className="panel-title-row"><div><span className="panel-icon"><Users size={18} /></span><h2>Friendships</h2></div><span className="panel-tag">{friends.length} friends</span></div>
      <p className="panel-description">Friend requests, your people, and a few profiles to meet.</p>
      {!user && <div className="feature-signin"><p>Sign in to find people and manage friend requests.</p><button onClick={onSignIn}>Sign in</button></div>}
      {user && <>
        {incoming.length > 0 && <section className="friend-section"><h3>Friend requests <span>{incoming.length}</span></h3>{incoming.map((request) => <FriendshipRowView key={request.id} row={request} userId={user.id} supabase={supabase} actions={<><button onClick={() => void action(() => onRespond(request.id, "accepted"))} disabled={busy}><Check size={14} /> Accept</button><button className="secondary" onClick={() => void action(() => onRespond(request.id, "declined"))} disabled={busy}>Decline</button></>} />)}</section>}
        {outgoing.length > 0 && <section className="friend-section"><h3>Sent requests <span>{outgoing.length}</span></h3>{outgoing.map((request) => <FriendshipRowView key={request.id} row={request} userId={user.id} supabase={supabase} actions={<span className="friend-state">Waiting for a reply</span>} />)}</section>}
        <section className="friend-section"><h3>Your friends <span>{friends.length}</span></h3>        {friends.length ? friends.map((friendship) => { const friendId = friendship.requester_id === user.id ? friendship.addressee_id : friendship.requester_id; return <FriendshipRowView key={friendship.id} row={friendship} userId={user.id} supabase={supabase} onViewProfile={() => onViewProfile(friendId)} actions={<button className="secondary" disabled={busy} onClick={() => void action(() => onBlock(friendId))}>Block</button>} />; }) : <p className="muted-copy">Your friend list will show up here when requests are accepted.</p>}</section>
        {blocked.length > 0 && <section className="friend-section"><h3>Blocked</h3>{blocked.map((row) => <FriendshipRowView key={row.id} row={row} userId={user.id} supabase={supabase} actions={<button className="secondary" disabled={busy} onClick={() => void action(() => onUnblock(row.requester_id === user.id ? row.addressee_id : row.requester_id))}>Unblock</button>} />)}</section>}
        <section className="friend-section"><h3>People you may know</h3><div className="friends-grid">
          {suggestions.map((person) => <article className="friend-card" key={person.id}><button className="friend-card-profile" onClick={() => onViewProfile(person.id)}><img src={person.avatar_url || DEFAULT_AVATAR} alt="" /><strong>{person.display_name}</strong><span>@{person.username || "member"}</span></button><small>{person.bio || "New to your community"}</small><button disabled={busy} onClick={() => void action(() => onSend(person.id))}><Users size={15} /> Add friend</button></article>)}
        </div>{!suggestions.length && <p className="muted-copy">No suggestions yet. Search for people using the bar above.</p>}</section>
      </>}
    </div>
  );
}

function FriendshipRowView({ row, userId, supabase, actions, onViewProfile }: { row: FriendshipRow; userId: string; supabase: SupabaseClient | null; actions: React.ReactNode; onViewProfile?: () => void }) {
  const personId = row.requester_id === userId ? row.addressee_id : row.requester_id;
  const [person, setPerson] = useState<Person | null>(null);
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    supabase.from("profiles").select("id, display_name, username, avatar_url").eq("id", personId).maybeSingle().then(({ data }) => {
      if (alive && data) setPerson(toPerson(data as ProfileRow, personId));
    });
    return () => { alive = false; };
  }, [personId, supabase]);
  return <div className="friendship-row"><img src={person?.avatar || DEFAULT_AVATAR} alt="" /><button className="friendship-person" onClick={onViewProfile} disabled={!onViewProfile}><strong>{person?.name || "MahinBook member"}</strong><small>@{person?.handle || "member"}</small></button><div>{actions}</div></div>;
}

function FriendProfilePage({ supabase, userId, onMessage, onBack }: { supabase: SupabaseClient | null; userId: string; onMessage: () => void; onBack: () => void }) {
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [posts, setPosts] = useState<FeedRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let alive = true;
    async function load() {
      setLoading(true);
      const [profileResult, postResult] = await Promise.all([
        supabase!.from("profiles").select("id, display_name, username, avatar_url, bio, cover_url, is_private, created_at").eq("id", userId).maybeSingle(),
        supabase!.from("posts").select("id, content, image_url, created_at, author_id, likes(user_id, reaction), comments(id, content, created_at, author_id, profiles!comments_author_id_fkey(id, display_name, username, avatar_url)), profiles!posts_author_id_fkey(id, display_name, username, avatar_url)").eq("author_id", userId).order("created_at", { ascending: false }).limit(20),
      ]);
      if (!alive) return;
      setProfile(profileResult.data as ProfileRow | null);
      setPosts((postResult.data || []) as FeedRow[]);
      setLoading(false);
    }
    void load();
    return () => { alive = false; };
  }, [supabase, userId]);
  if (loading) return <div className="profile-loading" role="status">Loading your friend’s profile…</div>;
  if (!profile) return <div className="panel-card profile-locked"><button className="profile-back" onClick={onBack}>← Back to friends</button><h2>This profile isn’t available</h2><p>This profile may be private or no longer available.</p></div>;
  const person = toPerson(profile, userId);
  return <div className="friend-profile-page"><button className="profile-back" onClick={onBack}>← Back to friends</button><section className="profile-hero-card"><div className="profile-hero-cover" style={profile.cover_url ? { backgroundImage: `linear-gradient(100deg, rgba(20,49,38,.16), rgba(20,49,38,.02)), url("${profile.cover_url}")` } : undefined} /><div className="profile-identity"><img className="profile-hero-avatar" src={person.avatar} alt="" /><div className="profile-identity-copy"><div className="profile-name-line"><h1>{person.name}</h1>{profile.is_private && <span className="profile-private-tag">Private</span>}</div><p className="profile-handle">@{person.handle}</p><p className="profile-bio">{profile.bio || "No bio yet."}</p></div><button className="profile-edit-button" onClick={onMessage}><MessageCircle size={15} /> Message</button></div><div className="profile-stat-row"><div><strong>{posts.length}</strong><span>Moments</span></div><span className="profile-stat-note">Friend profile</span></div></section><div className="posts-list friend-profile-posts">{posts.length ? posts.map((row) => <article className="post-card" key={row.id}><header className="post-header"><img className="post-avatar" src={person.avatar} alt="" /><div className="post-byline"><strong>{person.name}</strong><span>@{person.handle} · {timeAgo(row.created_at)}</span></div></header>{row.content && <p className="post-copy">{row.content}</p>}{row.image_url && <img className="post-image" src={row.image_url} alt="A moment shared by a friend" />}</article>) : <EmptyState title="No moments yet" text="When your friend shares moments, they’ll appear here." />}</div></div>;
}

type ConversationSummary = { id: string; title: string | null; is_group: boolean; members: Person[]; lastMessage: string; updatedAt: string };
type MessageRow = { id: string; sender_id: string; content: string; created_at: string; deleted_at: string | null; profiles: ProfileRow | ProfileRow[] | null };

function MessagesPanel({ supabase, user, friendships, currentUser, openWithUserId, onOpenedUser, onBlock, onSignIn, onError }: { supabase: SupabaseClient | null; user: { id: string } | null; friendships: FriendshipRow[]; currentUser: Person; openWithUserId: string | null; onOpenedUser: () => void; onBlock: (profileId: string) => Promise<void>; onSignIn: () => void; onError: (message: string) => void }) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [message, setMessage] = useState("");
  const [friendProfiles, setFriendProfiles] = useState<Person[]>([]);
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [groupTitle, setGroupTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [remoteTyping, setRemoteTyping] = useState(false);
  const [replyTo, setReplyTo] = useState<MessageRow | null>(null);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [mutedChats, setMutedChats] = useState<string[]>([]);
  const typingChannel = useRef<RealtimeChannel | null>(null);
  const typingTimeout = useRef<number | null>(null);
  const localTyping = useRef(false);

  const loadConversations = useCallback(async () => {
    if (!supabase || !user) { setConversations([]); return; }
    const { data: memberships, error: membershipError } = await supabase.from("conversation_members").select("conversation_id").eq("user_id", user.id);
    if (membershipError) { onError(`Could not load conversations: ${membershipError.message}`); return; }
    const ids = [...new Set((memberships || []).map((item) => item.conversation_id as string))];
    if (!ids.length) { setConversations([]); setSelectedId(null); return; }
    const { data, error: conversationError } = await supabase.from("conversations").select("id, title, is_group, created_at, conversation_members(user_id, profiles(id, display_name, username, avatar_url))").in("id", ids).order("created_at", { ascending: false });
    if (conversationError) { onError(`Could not load conversations: ${conversationError.message}`); return; }
    const [{ data: latestMessages }, { data: hiddenMessages }] = await Promise.all([
      supabase.from("messages").select("id, conversation_id, content, created_at, deleted_at").in("conversation_id", ids).order("created_at", { ascending: false }).limit(100),
      supabase.from("message_user_deletions").select("message_id").eq("user_id", user.id),
    ]);
    const hiddenIds = new Set((hiddenMessages || []).map((item) => item.message_id as string));
    const latestByConversation = new Map<string, { content: string; created_at: string; deleted_at: string | null }>();
    for (const item of latestMessages || []) if (!hiddenIds.has(item.id) && !latestByConversation.has(item.conversation_id)) latestByConversation.set(item.conversation_id, item);
    const mapped = (data || []).map((conversation) => {
      const members = (conversation.conversation_members || []).map((member: { user_id: string; profiles: ProfileRow | ProfileRow[] | null }) => toPerson(member.profiles, member.user_id));
      const latest = latestByConversation.get(conversation.id);
      return { id: conversation.id, title: conversation.title, is_group: conversation.is_group, members, lastMessage: latest?.deleted_at ? "This message was unsent" : latest?.content || "Start a conversation", updatedAt: latest?.created_at || conversation.created_at } as ConversationSummary;
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    setConversations(mapped);
    setSelectedId((current) => current && mapped.some((conversation) => conversation.id === current) ? current : mapped[0]?.id || null);
  }, [onError, supabase, user]);

  useEffect(() => { void loadConversations(); }, [loadConversations]);

  useEffect(() => {
    try { setMutedChats(JSON.parse(window.localStorage.getItem("mahinbook-muted-chats") || "[]") as string[]); } catch { setMutedChats([]); }
  }, []);

  useEffect(() => {
    if (!supabase || !user) { setFriendProfiles([]); return; }
    let alive = true;
    const ids = friendships.filter((item) => item.status === "accepted").map((item) => item.requester_id === user.id ? item.addressee_id : item.requester_id);
    if (!ids.length) { setFriendProfiles([]); return; }
    supabase.from("profiles").select("id, display_name, username, avatar_url").in("id", ids).then(({ data, error: friendError }) => {
      if (!alive) return;
      if (friendError) onError(`Could not load friends for messages: ${friendError.message}`);
      else setFriendProfiles((data || []).map((row) => toPerson(row as ProfileRow, row.id)));
    });
    return () => { alive = false; };
  }, [friendships, onError, supabase, user]);

  const selected = conversations.find((item) => item.id === selectedId) || null;
  const title = selected?.is_group ? selected.title || selected.members.map((member) => member.name).join(", ") : selected?.members.find((member) => member.id !== user?.id)?.name || "Conversation";

  const loadMessages = useCallback(async () => {
    if (!supabase || !selectedId) { setMessages([]); return; }
    if (!user) { setMessages([]); return; }
    const [{ data, error: messageError }, { data: hiddenMessages, error: hiddenError }] = await Promise.all([
      supabase.from("messages").select("id, sender_id, content, created_at, deleted_at, profiles!messages_sender_id_fkey(id, display_name, username, avatar_url)").eq("conversation_id", selectedId).order("created_at", { ascending: true }).limit(100),
      supabase.from("message_user_deletions").select("message_id").eq("user_id", user.id),
    ]);
    if (messageError) { onError(`Could not load messages: ${messageError.message}`); return; }
    if (hiddenError) { onError(`Could not load hidden messages: ${hiddenError.message}`); return; }
    const hiddenIds = new Set((hiddenMessages || []).map((item) => item.message_id as string));
    setMessages(((data || []) as MessageRow[]).filter((item) => !hiddenIds.has(item.id)));
  }, [onError, selectedId, supabase, user]);

  useEffect(() => { void loadMessages(); }, [loadMessages]);

  useEffect(() => {
    if (!supabase || !user || !selectedId) return;
    const channel = supabase.channel(`conversation:${selectedId}`, { config: { private: true, presence: { key: user.id } } });
    channel.on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${selectedId}` }, () => {
      void loadMessages();
      void loadConversations();
    });
    typingChannel.current = channel;
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      setOnlineUsers(Object.keys(state));
      setRemoteTyping(Object.values(state).flat().some((entry: any) => entry.user_id !== user.id && entry.typing === true));
    });
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED" && window.localStorage.getItem("mahinbook-show-online") !== "false") await channel.track({ user_id: user.id, name: currentUser.name, online_at: new Date().toISOString(), typing: false });
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") onError("Could not connect to this conversation’s live updates. Check the Realtime policies in the latest database migration.");
    });
    return () => { typingChannel.current = null; setRemoteTyping(false); void supabase.removeChannel(channel); };
  }, [currentUser.name, loadConversations, loadMessages, onError, selectedId, supabase, user]);

  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);

  async function createConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !user || !selectedMembers.length) return;
    setBusy(true);
    const { data, error: createError } = await supabase.rpc("create_conversation", {
      member_ids: selectedMembers,
      conversation_title: groupTitle.trim() || null,
    });
    setBusy(false);
    if (createError) { onError(`Could not start conversation: ${createError.message}`); return; }
    setNewConversationOpen(false);
    setSelectedMembers([]);
    setGroupTitle("");
    await loadConversations();
    setSelectedId(data as string);
  }

  async function openDirectMessage(friend: Person) {
    if (!supabase || !user) return;
    const existing = conversations.find((conversation) => !conversation.is_group && conversation.members.length === 2 && conversation.members.some((member) => member.id === friend.id) && conversation.members.some((member) => member.id === user.id));
    if (existing) { setSelectedId(existing.id); return; }
    setBusy(true);
    const { data, error: createError } = await supabase.rpc("create_conversation", { member_ids: [friend.id], conversation_title: null });
    setBusy(false);
    if (createError) { onError(`Could not open chat with ${friend.name}: ${createError.message}`); return; }
    await loadConversations();
    setSelectedId(data as string);
  }

  useEffect(() => {
    if (!openWithUserId) return;
    const friend = friendProfiles.find((person) => person.id === openWithUserId);
    if (friend) { void openDirectMessage(friend).then(onOpenedUser); }
  }, [openWithUserId, friendProfiles]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim() || !supabase || !user || !selectedId) return;
    const content = replyTo ? `↪ Reply to: “${replyTo.content.slice(0, 180)}”\n${message.trim()}` : message.trim();
    setMessage("");
    setReplyTo(null);
    if (typingTimeout.current) window.clearTimeout(typingTimeout.current);
    localTyping.current = false;
    const { error: sendError } = await supabase.from("messages").insert({ conversation_id: selectedId, sender_id: user.id, content });
    if (sendError) { setMessage(content); onError(`Could not send message: ${sendError.message}`); return; }
    await loadMessages();
    await loadConversations();
    if (window.localStorage.getItem("mahinbook-show-online") !== "false") void typingChannel.current?.track({ user_id: user.id, name: currentUser.name, online_at: new Date().toISOString(), typing: false });
  }

  function updateMessage(value: string) {
    setMessage(value);
    if (!typingChannel.current || !user || window.localStorage.getItem("mahinbook-show-online") === "false") return;
    if (value.trim() && !localTyping.current) {
      localTyping.current = true;
      void typingChannel.current.track({ user_id: user.id, name: currentUser.name, online_at: new Date().toISOString(), typing: true });
    }
    if (typingTimeout.current) window.clearTimeout(typingTimeout.current);
    typingTimeout.current = window.setTimeout(() => {
      localTyping.current = false;
      if (typingChannel.current && user) void typingChannel.current.track({ user_id: user.id, name: currentUser.name, online_at: new Date().toISOString(), typing: false });
    }, value.trim() ? 1100 : 0);
  }

  function toggleMute() {
    if (!selectedId) return;
    const next = mutedChats.includes(selectedId) ? mutedChats.filter((id) => id !== selectedId) : [...mutedChats, selectedId];
    setMutedChats(next);
    window.localStorage.setItem("mahinbook-muted-chats", JSON.stringify(next));
    setChatMenuOpen(false);
  }

  async function deleteConversationForMe() {
    if (!supabase || !user || !selectedId) return;
    const conversationId = selectedId;
    if (!window.confirm("Delete this conversation from your inbox? Other members will still have their copy.")) return;
    setBusy(true);
    const { error: deleteError } = await supabase.from("conversation_members").delete().eq("conversation_id", conversationId).eq("user_id", user.id);
    setBusy(false);
    if (deleteError) { onError(`Could not delete this conversation: ${deleteError.message}`); return; }
    setSelectedId(null);
    setMessages([]);
    setChatMenuOpen(false);
    await loadConversations();
  }

  async function deleteMessageForMe(item: MessageRow) {
    if (!supabase || !user) return;
    setBusy(true);
    const { error: deleteError } = await supabase.from("message_user_deletions").insert({ message_id: item.id, user_id: user.id });
    setBusy(false);
    if (deleteError) { onError(`Could not delete this message for you: ${deleteError.message}`); return; }
    setMessages((current) => current.filter((messageItem) => messageItem.id !== item.id));
    await loadConversations();
  }

  async function unsendMessage(item: MessageRow) {
    if (!supabase || !user || item.sender_id !== user.id || item.deleted_at) return;
    setBusy(true);
    const { error: unsendError } = await supabase.from("messages").update({ content: "This message was unsent", deleted_at: new Date().toISOString() }).eq("id", item.id).eq("sender_id", user.id).is("deleted_at", null);
    setBusy(false);
    if (unsendError) { onError(`Could not unsend this message: ${unsendError.message}`); return; }
    await loadMessages();
    await loadConversations();
  }

  return (
    <div className="messages-card">
      <div className="message-list">
        <div className="message-list-heading"><strong>Inbox</strong>{friendProfiles.length > 1 && <button className="new-group-button" onClick={() => user ? setNewConversationOpen(true) : onSignIn()}>New group</button>}</div>
        {!user && <p className="muted-copy message-signin">Sign in to message friends.</p>}
        {user && friendProfiles.filter((friend) => !conversations.some((conversation) => !conversation.is_group && conversation.members.length === 2 && conversation.members.some((member) => member.id === friend.id))).map((friend) => <button className="message-person" key={`friend-${friend.id}`} onClick={() => void openDirectMessage(friend)} disabled={busy}><span className="message-avatar"><img src={friend.avatar} alt="" /><i /></span><span><strong>{friend.name}</strong><small>New friend · start chatting</small></span></button>)}
        {conversations.map((conversation) => {
          const conversationTitle = conversation.is_group ? conversation.title || conversation.members.map((member) => member.name).join(", ") : conversation.members.find((member) => member.id !== user?.id)?.name || "Conversation";
          return <button className={`message-person ${selectedId === conversation.id ? "message-person-active" : ""}`} key={conversation.id} onClick={() => setSelectedId(conversation.id)}>
            <span className="message-avatar"><img src={conversation.members.find((member) => member.id !== user?.id)?.avatar || DEFAULT_AVATAR} alt="" /><i className={onlineUsers.length ? "is-online" : ""} /></span>
            <span><strong>{conversationTitle}</strong><small>{conversation.lastMessage}</small></span><time>{timeAgo(conversation.updatedAt)}</time>
          </button>;
        })}
        {user && !conversations.length && <p className="muted-copy message-signin">No conversations yet. Start one with a friend.</p>}
      </div>
      {selected ? <div className="conversation">
        <div className="conversation-header"><img src={selected.members.find((member) => member.id !== user?.id)?.avatar || DEFAULT_AVATAR} alt="" /><div><strong>{title}</strong><span>{remoteTyping ? "Typing…" : onlineUsers.length > 1 ? "Friend is online" : selected.is_group ? `${selected.members.length} members` : "Private conversation"}</span></div><button aria-label="Conversation options" onClick={() => setChatMenuOpen((open) => !open)}><MoreHorizontal size={20} /></button>{chatMenuOpen && <div className="chat-control-menu"><button onClick={toggleMute}>{mutedChats.includes(selected.id) ? "Unmute chat" : "Mute chat"}</button><button onClick={() => { setSelectedId(null); setChatMenuOpen(false); }}>Close conversation</button><button onClick={() => void deleteConversationForMe()} disabled={busy}>Delete conversation for me</button>{!selected.is_group && <button onClick={() => { const friendId = selected.members.find((member) => member.id !== user?.id)?.id; if (friendId) void onBlock(friendId); setChatMenuOpen(false); }}>Block person</button>}</div>}</div>
        <div className="conversation-body">{messages.length === 0 && <p className="message-empty">Say hello and start this conversation.</p>}{messages.map((item) => {
          const author = toPerson(item.profiles, item.sender_id);
          return <div className={`message-line ${item.sender_id === user?.id ? "message-line-own" : ""}`} key={item.id}>{selected.is_group && item.sender_id !== user?.id && <small>{author.name}</small>}<div className={`chat-bubble ${item.sender_id === user?.id ? "sent" : "received"} ${item.deleted_at ? "chat-bubble-deleted" : ""}`}>{item.deleted_at ? "This message was unsent" : item.content}</div><div className="message-inline-actions"><button onClick={() => setReplyTo(item)} disabled={Boolean(item.deleted_at)}>Reply</button><button onClick={() => { setMessage(`Forwarded message: “${item.content}”`); setReplyTo(null); }} disabled={Boolean(item.deleted_at)}>Forward</button><button onClick={() => void deleteMessageForMe(item)} disabled={busy}>Delete for me</button>{item.sender_id === user?.id && !item.deleted_at && <button className="message-unsend-action" onClick={() => void unsendMessage(item)} disabled={busy}>Unsend for everyone</button>}</div><time>{timeAgo(item.created_at)}</time></div>;
        })}</div>
        <form className="message-compose" onSubmit={(event) => void sendMessage(event)}>
          {replyTo && <div className="replying-to">Replying to “{replyTo.content.slice(0, 72)}”<button type="button" aria-label="Cancel reply" onClick={() => setReplyTo(null)}><X size={13} /></button></div>}
          <input value={message} onChange={(event) => updateMessage(event.target.value)} placeholder={`Message ${title.split(",")[0]}...`} aria-label="Write a message" disabled={!user} />
          <button disabled={!message.trim() || busy} aria-label="Send message"><Send size={16} /></button>
        </form>
      </div> : <div className="conversation conversation-no-selection"><MessageCircle size={26} /><strong>Your conversations live here</strong><span>Choose a friend to say hello.</span></div>}
      {newConversationOpen && <div className="new-conversation-overlay"><form className="new-conversation" onSubmit={(event) => void createConversation(event)}><button type="button" className="modal-close" aria-label="Close" onClick={() => setNewConversationOpen(false)}><X size={17} /></button><h2>Start a group chat</h2><p>Choose two or more friends.</p>{friendProfiles.length > 1 && <input value={groupTitle} onChange={(event) => setGroupTitle(event.target.value)} placeholder="Group name (optional)" aria-label="Group name" />}{friendProfiles.map((friend) => <label key={friend.id}><input type="checkbox" checked={selectedMembers.includes(friend.id)} onChange={(event) => setSelectedMembers((ids) => event.target.checked ? [...ids, friend.id] : ids.filter((id) => id !== friend.id))} /><img src={friend.avatar} alt="" />{friend.name}</label>)}{!friendProfiles.length && <p className="muted-copy">Accept a friend request before starting a conversation.</p>}<button className="auth-submit" disabled={selectedMembers.length < 2 || busy}>{busy ? "Starting…" : "Start group chat"} <Send size={15} /></button></form></div>}
    </div>
  );
}

function SettingsPanel({ user, profile, isConnected, databaseReady, isPrivate, messageAlerts, busy, onSignIn, onSignOut, onTogglePrivacy, onToggleMessageAlerts, onDeleteAccount, onSaveProfile }: { user: { id: string; email?: string; name: string } | null; profile: ProfileRow | null; isConnected: boolean; databaseReady: boolean; isPrivate: boolean; messageAlerts: boolean; busy: boolean; onSignIn: () => void; onSignOut: () => void; onTogglePrivacy: () => void; onToggleMessageAlerts: () => void; onDeleteAccount: () => void; onSaveProfile: (event: FormEvent<HTMLFormElement>, values: { display_name: string; username: string; bio: string }, avatar: File | null, cover: File | null) => void }) {
  const [name, setName] = useState(profile?.display_name || user?.name || "");
  const [username, setUsername] = useState(profile?.username || "");
  const [bio, setBio] = useState(profile?.bio || "");
  const [avatar, setAvatar] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [showOnline, setShowOnline] = useState(true);
  useEffect(() => {
    setName(profile?.display_name || user?.name || "");
    setUsername(profile?.username || "");
    setBio(profile?.bio || "");
  }, [profile, user]);
  useEffect(() => {
    setShowOnline(window.localStorage.getItem("mahinbook-show-online") !== "false");
  }, []);
  return (
    <div className="panel-card settings-panel">
      <div className="panel-title-row"><div><span className="panel-icon"><Settings size={18} /></span><h2>Your profile &amp; settings</h2></div></div>
      <p className="panel-description">Keep your profile up to date and choose how people can see what you share.</p>
      <div className="settings-row"><span><strong>Account</strong><small>{user ? user.email : "You’re browsing in preview mode"}</small></span>{user ? <button onClick={onSignOut}>Sign out</button> : <button onClick={onSignIn}>Sign in</button>}</div>
      {user && <form className="profile-edit-form" onSubmit={(event) => onSaveProfile(event, { display_name: name, username, bio }, avatar, cover)}>
        <h3><UserRound size={16} /> Edit profile</h3>
        <label>Display name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} /></label>
        <label>Username<input value={username} onChange={(event) => setUsername(event.target.value)} required maxLength={24} /></label>
        <label>Bio<textarea value={bio} onChange={(event) => setBio(event.target.value)} maxLength={500} rows={3} placeholder="A little about you..." /></label>
        <div className="profile-file-fields"><label>Profile photo<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setAvatar(event.target.files?.[0] || null)} /></label><label>Cover photo<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setCover(event.target.files?.[0] || null)} /></label></div>
        <button className="share-button" disabled={busy}>{busy ? "Saving…" : "Save profile"} <Check size={15} /></button>
      </form>}
      <section className="settings-section"><h3>Privacy &amp; safety</h3><div className="settings-row"><span><strong>Lock your profile</strong><small>{isPrivate ? "Only accepted friends can see your profile and friends only posts" : "Anyone can view your public profile and public posts"}</small></span><button className={`privacy-toggle ${isPrivate ? "privacy-toggle-on" : ""}`} aria-pressed={isPrivate} onClick={onTogglePrivacy}>{isPrivate ? "Locked" : "Unlocked"}</button></div><div className="settings-row"><span><strong>Online status</strong><small>Let friends see when you’re active</small></span><button className={`privacy-toggle ${showOnline ? "" : "privacy-toggle-on"}`} aria-pressed={showOnline} onClick={() => { const next = !showOnline; setShowOnline(next); window.localStorage.setItem("mahinbook-show-online", String(next)); }}>{showOnline ? "On" : "Off"}</button></div></section>
      <section className="settings-section"><h3>Notifications</h3><div className="settings-row"><span><strong>Message alerts</strong><small>Show message notifications in the notifications panel</small></span><button className={`privacy-toggle ${messageAlerts ? "" : "privacy-toggle-on"}`} aria-pressed={messageAlerts} onClick={onToggleMessageAlerts}>{messageAlerts ? "On" : "Off"}</button></div></section>
      <div className="settings-row"><span><strong>Delete your account</strong><small>Permanently remove your profile and community data</small></span><button className="delete-account-button" onClick={onDeleteAccount}>Delete account</button></div>
      <div className={`connection-status ${databaseReady ? "connected" : ""}`}><span />{databaseReady ? "Supabase connected · feed synced" : isConnected ? "Supabase ready · sign in to sync your feed" : "Preview mode — add Supabase keys to save changes"}</div>
    </div>
  );
}

function NotificationsPanel({ notifications, onClose, onRefresh }: { notifications: NotificationRow[]; onClose: () => void; onRefresh: () => void }) {
  return <div className="notifications-panel">
    <div className="notifications-heading"><strong>Notifications</strong><button onClick={onRefresh}>Refresh</button><button aria-label="Close notifications" onClick={onClose}><X size={15} /></button></div>
    {!notifications.length && <p className="muted-copy">You’re all caught up.</p>}
    {notifications.map((notification) => {
      const actor = toPerson(notification.profiles, "");
      const subject = notification.kind === "friend_request" ? "sent you a friend request" : notification.kind === "friend_accepted" ? "accepted your friend request" : notification.kind === "like" ? "reacted to your post" : notification.kind === "comment" ? "commented on your post" : "sent you a message";
      return <div className={`notification-item ${notification.read_at ? "" : "notification-unread"}`} key={notification.id}><img src={actor.avatar} alt="" /><span><strong>{actor.name}</strong> {subject}<small>{timeAgo(notification.created_at)}</small></span><i /></div>;
    })}
  </div>;
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="empty-state"><span><Bookmark size={21} /></span><strong>{title}</strong><p>{text}</p></div>;
}

function getPageSubtitle(page: PageKey) {
  if (page === "friends") return "Good people are closer than you think.";
  if (page === "messages") return "A little hello goes a long way.";
  if (page === "saved") return "The things you want to come back to.";
  return "A few small ways to make this feel like yours.";
}
