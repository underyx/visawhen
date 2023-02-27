# first line: 1
@memory.cache
def parse_page(path: Path) -> pd.DataFrame:
    parsed = camelot.read_pdf(str(path), pages="1-end")
    if len(parsed) == 0 or len(parsed[0].df.columns) < 3:
        return pd.DataFrame(columns=["Post", "Visa Class", "Issuances", "Post","Visa Class", "Month", "Issuances"])
    table = parsed[0].df
    table.columns = ["Post", "Visa Class", "Issuances"]
    table["Issuances"] = pd.to_numeric(
        table["Issuances"].replace(r"\D", "", regex=True),
        errors="coerce",
        downcast="integer",
    )
    table = table.replace("", pd.NA).dropna().reset_index(drop=True)
    table["Post"] = pd.Series(table["Post"], dtype="string")
    table["Visa Class"] = pd.Series(table["Visa Class"], dtype="string")
    table["Month"] = pd.Timestamp(
        arrow.get(
            path.name.replace("NIV-", "").replace("IV-", "").replace(".pdf", "")
        ).format("YYYYMMDD")
    )
    table["Issuances"] = table["Issuances"].astype("uint16")
    return table
