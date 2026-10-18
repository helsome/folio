// Native SIP verifies the PE content digest; .NET SignedCms verifies the signer.
// No trust-store changes, custom PE hashing, or acceptance of trust errors as integrity proof.
using System;
using System.Runtime.InteropServices;
public static class FolioAuthenticodeIntegrity {
    [StructLayout(LayoutKind.Sequential)] struct Blob { public uint Size; public IntPtr Data; }
    [StructLayout(LayoutKind.Sequential)] struct Algorithm { public IntPtr Oid; public Blob Parameters; }
    [StructLayout(LayoutKind.Sequential)] struct Attribute { public IntPtr Oid; public Blob Value; }
    [StructLayout(LayoutKind.Sequential)] struct Indirect { public Attribute Data; public Algorithm Algorithm; public Blob Digest; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Subject {
        public uint Size; public IntPtr Type; public IntPtr File;
        [MarshalAs(UnmanagedType.LPWStr)] public string FileName;
        [MarshalAs(UnmanagedType.LPWStr)] public string DisplayName;
        public uint Reserved1, Version; public IntPtr Provider; public Algorithm Algorithm;
        public uint Flags, Encoding, Reserved2, CapiSettings, SecuritySettings, Index, UnionChoice;
        public IntPtr ExtraInfo, ClientData;
    }
    [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool CryptSIPRetrieveSubjectGuid(string fileName, IntPtr file, out Guid subject);
    [DllImport("crypt32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool CryptDecodeObjectEx(uint encoding, IntPtr type, byte[] encoded, uint length,
        uint flags, IntPtr parameters, out IntPtr decoded, ref uint size);
    [DllImport("crypt32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool CryptSIPVerifyIndirectData(ref Subject subject, IntPtr indirect);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
    public static bool VerifyFileDigest(string path, byte[] encodedIndirectData) {
        IntPtr decoded = IntPtr.Zero, type = IntPtr.Zero;
        try {
            Guid guid;
            if (!CryptSIPRetrieveSubjectGuid(path, IntPtr.Zero, out guid)) return false;
            uint size = 0;
            // SPC_INDIRECT_DATA_STRUCT=2001, CRYPT_DECODE_ALLOC_FLAG=0x8000.
            if (!CryptDecodeObjectEx(0x10001, new IntPtr(2001), encodedIndirectData,
                (uint)encodedIndirectData.Length, 0x8000, IntPtr.Zero, out decoded, ref size)) return false;
            var indirect = Marshal.PtrToStructure<Indirect>(decoded);
            if (Marshal.PtrToStringAnsi(indirect.Algorithm.Oid) != "2.16.840.1.101.3.4.2.1") return false;
            type = Marshal.AllocHGlobal(Marshal.SizeOf<Guid>());
            Marshal.StructureToPtr(guid, type, false);
            var subject = new Subject { Size = (uint)Marshal.SizeOf<Subject>(), Type = type,
                File = new IntPtr(-1), FileName = path, Algorithm = indirect.Algorithm, Encoding = 0x10001 };
            return CryptSIPVerifyIndirectData(ref subject, decoded);
        } finally {
            if (decoded != IntPtr.Zero) LocalFree(decoded);
            if (type != IntPtr.Zero) Marshal.FreeHGlobal(type);
        }
    }
}
