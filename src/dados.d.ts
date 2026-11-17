/** A base entra no bundle como texto (loader "text" do esbuild) e só é analisada no primeiro uso. */
declare module "*.json" {
	const texto: string;
	export default texto;
}
