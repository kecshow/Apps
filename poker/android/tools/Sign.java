import com.android.apksig.ApkSigner;
import java.io.File;
import java.io.FileInputStream;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.Collections;

/** Signs an APK with an APK Signature Scheme v2 signature (Android 7.0+) using apksig. Args: in.apk out.apk keystore.p12 password alias */
public class Sign {
    public static void main(String[] a) throws Exception {
        KeyStore ks = KeyStore.getInstance("PKCS12");
        try (FileInputStream in = new FileInputStream(a[2])) { ks.load(in, a[3].toCharArray()); }
        PrivateKey key = (PrivateKey) ks.getKey(a[4], a[3].toCharArray());
        X509Certificate cert = (X509Certificate) ks.getCertificate(a[4]);
        ApkSigner.SignerConfig cfg = new ApkSigner.SignerConfig.Builder("release", key, Collections.singletonList(cert)).build();
        new ApkSigner.Builder(Collections.singletonList(cfg))
            .setInputApk(new File(a[0])).setOutputApk(new File(a[1]))
            .setV1SigningEnabled(false).setV2SigningEnabled(true)
            .setMinSdkVersion(24)
            .build().sign();
        System.out.println("signed " + a[1]);
    }
}
