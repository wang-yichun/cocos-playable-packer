declare namespace Editor {
  const Project: {
    readonly name: string;
    readonly path: string;
    readonly tmpDir: string;
    readonly uuid: string;
  };

  namespace Panel {
    function open(name: string): Promise<void>;
    function define<T>(definition: T): T;
  }

  namespace Message {
    function request<T = unknown>(
      packageName: string,
      message: string,
      ...args: unknown[]
    ): Promise<T>;
  }
}
