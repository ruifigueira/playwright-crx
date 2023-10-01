import { promises } from "./index";

export const { readFile, readlink, rename, readdir, stat, lstat } = promises;

export const realpath = () => ({});