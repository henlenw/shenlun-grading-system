// Serializes cloud writes while persisting every keystroke locally.
export class DraftSync {
  text: string;
  version: number;
  private saved: string;
  private pending: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    text: string,
    version: number,
    private save: (text: string, version: number) => Promise<{ version: number }>,
    private persist: (text: string, version: number) => void,
    private status: (message: string) => void,
  ) {
    this.text = text;
    this.saved = text;
    this.version = version;
  }
  change(text: string) {
    this.text = text;
    this.persist(text, this.version);
    this.status('已保存到本机');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush().catch(() => {});
    }, 700);
  }
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending) {
      await this.pending;
      return this.flush();
    }
    if (this.text === this.saved) return;
    const snapshot = this.text;
    this.status('正在同步…');
    this.pending = (async () => {
      try {
        const result = await this.save(snapshot, this.version);
        this.version = result.version;
        this.saved = snapshot;
        this.persist(this.text, this.version);
        this.status(this.text === snapshot ? '已同步到云端' : '已保存到本机');
      } catch (e: any) {
        this.status(e.message || '同步失败，草稿已保留');
        throw e;
      } finally {
        this.pending = null;
      }
    })();
    await this.pending;
    if (this.text !== this.saved) await this.flush();
  }
  adoptVersion(version: number) {
    this.version = version;
    this.persist(this.text, version);
  }
  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.persist(this.text, this.version);
  }
}
