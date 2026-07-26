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

  interface DialogFilter {
    name: string;
    extensions: string[];
  }

  interface SelectDialogOptions {
    title?: string;
    button?: string;
    path?: string;
    type?: "directory" | "file";
    multi?: boolean;
    filters?: DialogFilter[];
    extensions?: string[];
  }

  interface OpenDialogReturnValue {
    canceled: boolean;
    filePaths: string[];
  }

  interface SaveDialogReturnValue {
    canceled: boolean;
    filePath: string;
  }

  namespace Dialog {
    function select(options?: SelectDialogOptions): Promise<OpenDialogReturnValue>;
    function save(options?: SelectDialogOptions): Promise<SaveDialogReturnValue>;
  }

  namespace Message {
    function request<T = unknown>(
      packageName: string,
      message: string,
      ...args: unknown[]
    ): Promise<T>;
  }
}
