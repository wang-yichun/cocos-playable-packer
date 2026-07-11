declare namespace EmscriptenWasm {
    interface ModuleOpts {
        locateFile?: (
            path: string,
            prefix?: string,
        ) => string;
        instantiateWasm?: (
            imports: WebAssembly.Imports,
            successCallback: (
                module: WebAssembly.Module,
            ) => void,
        ) => WebAssembly.Exports;
    }

    interface Module {}

    type ModuleFactory<
        T extends Module = Module,
    > = (
        moduleOverrides?: ModuleOpts,
    ) => Promise<T>;
}
