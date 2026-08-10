declare module 'nifti-reader-js' {
    interface NiftiHeader {
        datatypeCode: number;
        dims: number[];
        pixDims: number[];
        scl_slope: number;
        scl_inter: number;
    }

    function isCompressed(data: ArrayBuffer): boolean;
    function decompress(data: ArrayBuffer): ArrayBuffer;
    function isNIFTI(data: ArrayBuffer): boolean;
    function readHeader(data: ArrayBuffer): NiftiHeader;
    function readImage(header: NiftiHeader, data: ArrayBuffer): ArrayBuffer;
}
