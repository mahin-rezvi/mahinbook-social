export type Person = {
  id: string;
  name: string;
  handle: string;
  avatar: string;
};

export type Comment = {
  id: string;
  author: Person;
  text: string;
  time: string;
};

export type ReactionType = "like" | "love" | "care" | "haha" | "wow" | "sad" | "angry";

export type Post = {
  id: string;
  author: Person;
  time: string;
  content: string;
  image?: string;
  imageAlt?: string;
  likes: number;
  comments: Comment[];
  liked: boolean;
  reaction?: ReactionType;
  location?: string;
};

export const DEFAULT_AVATAR = "/avatar-placeholder.svg";
