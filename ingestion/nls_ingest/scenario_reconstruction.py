"""Reconstruct high-confidence scenario groups from original NLS past papers.

The mapping is deliberately curated: every group below was checked against the
source paper.  Run without ``--apply`` for a read-only audit, then use
``--apply`` to write the grouping fields in one transaction.
"""

from __future__ import annotations

import argparse
import json
import uuid

from .db import connect


NAMESPACE = uuid.UUID("6db52a15-b6a9-4fb4-a5c4-e9104111eb62")


GROUPS = [
    ("2011-charge-bob-joseph", 674, [484, 486], "An application for leave to prefer a charge under section 185(b) of the Criminal Procedure Code was brought before Justice Pam of the Plateau State High Court after Justice Dung, another judge of that court, had refused the same application. The charge was against Bob Guy and Joseph Masters. Bob said the Governor of Plateau State had pardoned him for the offence before his arrest. Joseph refused to plead, and the trial judge treated the refusal as malicious and ordered that he be remanded until the Governor's pleasure was known. Bob was discharged but immediately rearrested before leaving the dock."),
    ("2011-anasco-board-meeting", 674, [499, 500], "Anasco Nigeria Limited was incorporated on 1 April 2009. At its second Board meeting, the Chairman, Chief Oyin Udo, arrived two hours late. Three of the company's six directors passed a resolution appointing Mr Okey Hassan to chair that day's meeting."),
    ("2011-enquary-object-clause", 674, [503, 504], "En-Quary Company Limited was formed to extract solid minerals from available mining fields. The Federal Ministry of Solid Minerals revoked its mining licence and warned its directors to stop further mining. The company is considering altering its objects, winding up voluntarily, or merging with a company that holds an operating licence."),
    ("2011-inyang-fundamental-rights", 675, [566, 567], "Mr Bitrus Inyang was beaten unconscious by police officers at a roadblock on the Abuja-Mararraba Road after refusing to switch on his car's interior light. The officers abandoned him without taking him to hospital. After regaining consciousness, he considered bringing an action to enforce his fundamental rights."),
    ("2011-aboki-refusal-to-plead", 675, [569, 570], "When a charge of rioting while armed with a deadly weapon was read in English and explained in Hausa to Mallam Aboki Babali at the High Court of the Federal Capital Territory on 27 July 2011, he merely looked at the trial judge and said nothing."),
    ("2011-green-bank-share-allotment", 675, [597, 598], "Otunba Yemi Smith applied for 1,000 ordinary shares in Green Bank Plc's public offer and paid in full. About three years later the bank sent him a certificate for only 600 shares. After the company's shares crashed, it issued him a further 400 shares by special placement."),
    ("2012-nnodi-rape-trial", 676, [688, 690, 692, 693], "Nnodi, Chukwuani and Nnamdi picked up Antonia after leaving Millennium Hotel, Yenagoa, on 1 January 2012. They stopped in a bush, raped her and left her there. Antonia reported the incident, and the three suspects were arrested, arraigned and later granted bail."),
    ("2012-rhoda-property-transactions", 676, [743, 745, 747, 753, 755], "Mrs Gertrude Rhoda owns properties in Ikeja, Dutse, Uromi and Ikoyi. She obtained a N350 million loan from Diamond Bank Plc and proposed the Ikeja property as security. She also intended to grant terms over other properties and sell the Ikoyi property, while authorising her solicitor to handle the transactions and prepare for the disposition of her estate after death."),
    ("2019-apagu-recovery-of-premises", 677, [852, 854, 857], "Chief Apagu Agu owns a shopping mall at No. 1 Ajayi Wafer's Close, Kubwa, Abuja. Chief Ugoh Okaka took a shop there under a yearly tenancy beginning 1 January 2018, with a covenant restricting use to buying and selling. He converted the shop into a religious worship centre, and the landlord instructed counsel to recover possession."),
    ("2019-dandam-chieftaincy-action", 677, [867], "After the death of Chief Awal Amadu, the stool of the paramount ruler of Burugu Kingdom became vacant. Alhaji Awal Jauro of the Wambai ruling family was nominated by the kingmakers. The Dandam ruling family believed it was their turn and instructed counsel to seek legal redress."),
    ("2019-stay-of-proceedings", 677, [871], "During a Lagos High Court externship, counsel for the claimant asked the court to hear a pending motion for stay of proceedings. Defence counsel argued that the motion was not ripe because the response period had not expired. The court refused to hear the application."),
    ("2019-bobo-ikemson-arrest", 677, [900, 903, 906], "Police stopped Bobo Ikemson at midnight on 1 August 2018 at Bakori Junction, Maitama, Abuja. A female inspector, Josephine Johnson, searched him and found a substance suspected to be heroin in his car. He was arrested and detained for two days without being taken to court or given access to his family or lawyers."),
    ("2019-masuku-power-of-attorney", 677, [966, 968, 972], "Mallam Buba Kawuche, a civil servant posted to the Nigerian Embassy in London, authorised Mrs Masuku Abamba to manage properties in Abuja and Enugu for consideration of N50 million, including authority to sell and convey the interests to purchasers."),
    ("2019-arbitration-award", 678, [1439, 1441], "Mr A and Mr B referred their dispute to an impartial third party, who determined it judicially and issued an award on 31 January 2019. Mr B intends to ask the High Court to set the award aside."),
    ("2015-adanu-high-court-process", 715, [2219, 2220, 2223], "Adanu Aboyinu wanted to sue Joe Jack, a resident of Gwagwalada Area Council, Abuja. He gave the process registrar a writ of summons, statement of claim, witness statements on oath, copies of documents to be relied on, and a certificate of pre-action counselling. The registrar said a condition precedent to issuance of the writ had not been fulfilled."),
    ("2016-chief-abel-election-petition", 716, [2308, 2309, 2310], "During an externship at J.T. Alade & Co., Chief Ade Abel instructed Mr J.T. Alade, SAN, to challenge a senatorial election in Oyo State. Chief Abel, the MAP candidate, lost to Dr Lola Yori of the DPCP. The election was held on 14 June 2016 and the result was declared on 15 June 2016."),
    ("2016-hutu-dishonoured-cheque", 716, [2319, 2320], "Chief John Hutu gave Planwell (Nig.) Ltd a N50 million cheque for services on 5 August 2014. Trinity Bank called to confirm payment two days later. Chief Hutu authorised payment, but the official misunderstood him and dishonoured the cheque. Planwell commenced an action by originating motion in the High Court."),
    ("2016-barkin-ladi-mangu-halle", 716, [2324, 2325], "During a Plateau State High Court externship, criminal proceedings were instituted against Barkin Ladi and Mangu Halle for culpable homicide punishable with death after leave was obtained. Their application for bail was refused."),
    ("2018-madam-sade-loan", 717, [2259, 2261, 2263, 2265, 2267], "Madam Sade, a Lagos philanthropist, lent money to her Lagos-based childhood friend Adaora for a mechanised farming business. The Lagos loan agreement was guaranteed by Adaora's boyfriend, Sulu Anga, who lives in Abuja. Adaora defaulted despite demands, so Madam Sade decided to sue Adaora and Sulu Anga in the Lagos High Court."),
    ("2018-agaga-fundamental-rights", 717, [2273, 2276], "Mrs Agaga Okafor reported that the Economic and Financial Crimes Commission arrested and detained her husband on 28 June 2018 on an allegation of money laundering. Efforts to secure his release failed, and counsel prepared proceedings challenging the detention."),
    ("2018-zion-reregistration", 717, [2283, 2286], "Zion Nigeria Ltd was incorporated on 25 August 2014. At its first Annual General Meeting in 2016, resolutions were passed to convert and re-register it as a public company and increase its share capital from N100 million to N500 million ordinary shares."),
    ("2018-emerald-name-change", 717, [2288, 2290], "Emerald Nigeria Limited was incorporated in 2013 and now seeks to change its name to Favor Nigeria Limited."),
    ("2018-capital-gain-oppression", 717, [2296, 2298], "Capital Gain Ventures Limited is a major energy-sector company. Its Board is divided along political-party lines and has failed to hold Board or general meetings. There is evidence that its Chairman and Managing Director are managing it in an unfairly prejudicial and oppressive manner."),
    ("2020-dogo-yunus-accident", 720, [2673, 2675], "Roland Giddy drove at high speed while using his phone on Eko Hotel Road, Victoria Island, and collided with Mr Dogo Yunus's Prado Jeep. Mr Yunus, his wife and their seven-year-old son were badly injured, and the Jeep was damaged. They sued to recover medical and repair costs and damages."),
    ("2020-kingsley-mallam-interpleader", 720, [2679], "Mr John Pam died intestate, leaving two adult sons. The title document to his only property remained with his solicitor, Mr Kingsley Mallam, while letters of administration were pending. Both sons demanded the document, so the solicitor approached the court to determine who was entitled to it."),
    ("2020-bolanle-recovery", 720, [2683], "Miss Bolanle is a yearly tenant of Mr Peter Azi at No. 22 Gwarimpa Estate, Abuja. She defaulted in paying the annual rent, and Mr Azi instructed counsel to recover possession."),
    ("2020-gety-ali-trial", 720, [2689], "Mrs Gety Ali was tried in the High Court of the Federal Capital Territory for culpable homicide punishable with death. The charge omitted the statutory provision. She pleaded not guilty, was convicted and sentenced to death by lethal injection while six months pregnant, and appealed with an application for bail pending appeal."),
    ("2020-jerry-musa-charge", 720, [2695], "Jerry Musa was arraigned before a Magistrates' Court in Lafia on a charge alleging that he stabbed Mallam Bitrus Kolo and assaulted Miss Binta Kolo in one count under the Penal Code of Nasarawa State."),
    ("2020-mohammed-kurata-bail", 720, [2701, 2702], "Mohammed Kurata was brought before a Chief Magistrates' Court in Kano for armed robbery and pleaded not guilty to the First Information Report. His bail application was refused because the Magistrate lacked jurisdiction to try the offence and directed him to apply to the High Court."),
    ("2020-restaurant-business-name", 720, [2707, 2708, 2710], "After your Call to the Bar, a friend's mother instructed you to register her restaurant with the Corporate Affairs Commission as a sole-proprietorship business."),
    ("2021-omodudu-general-meeting", 723, [2534, 2535, 2536, 2540], "Omodudu Nigeria Plc was incorporated on 2 January 2014. It neither held a statutory meeting nor filed a statutory report. At its fifth AGM, Mrs Longe was not served notice because the secretary expected her to be absent for a swearing-in ceremony. She later transferred all her shares equally to Chief and Mrs Pepple."),
    ("2022-interlocutory-injunction", 729, [2582, 2583, 2584, 2585], "During court externship, students observed the moving of a motion for interlocutory injunction in a suit between James Abeki and Ditoran Nigeria Limited."),
    ("2022-counterfeit-currency-trial", 729, [2592, 2594], "The Attorney-General of the Federation commenced a criminal trial against Mr Babafemi Ajanga and Miss Fetimehin Usman for conspiracy and possession of counterfeit currency. Four prosecution witnesses were called. Counsel objected when the defendants' statements were tendered: the first denied making his statement, while the second alleged that his was involuntary."),
]


STEM_OVERRIDES = {
    484: "After the application for leave to prefer a charge was refused by Justice Dung, what should the prosecutor do?",
    499: "When should the company's first Board of Directors' meeting be held?",
    1439: "Within what period may Mr B apply to the High Court to set aside the award?",
}


AMBIGUOUS = [363, 364, 386, 387, 400, 402, 406, 407, 2102, 2104, 2114, 2116, 2122, 2186, 2200, 2201, 2204, 2210, 2238, 2240, 2242, 2244, 2518, 2522, 2526]


def run(apply: bool = False) -> dict:
    expected_ids = [question_id for _, _, ids, _ in GROUPS for question_id in ids]
    report = {"mode": "apply" if apply else "dry-run", "groups": [], "ambiguous": AMBIGUOUS}
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id,source_document_id,verification_status,context_group_id
                   FROM questions WHERE id=ANY(%s)""",
                (expected_ids,),
            )
            rows = {row[0]: row for row in cur.fetchall()}
            for slug, source_id, question_ids, scenario in GROUPS:
                missing = [qid for qid in question_ids if qid not in rows]
                not_live = [qid for qid in question_ids if qid in rows and rows[qid][2] not in ("material_supported", "staff_corrected")]
                wrong_source = [qid for qid in question_ids if qid in rows and rows[qid][1] != source_id]
                conflicts = [qid for qid in question_ids if qid in rows and rows[qid][3] is not None]
                status = "ready" if not (missing or not_live or wrong_source or conflicts) else "skipped"
                entry = {"slug": slug, "source_id": source_id, "question_ids": question_ids, "status": status,
                         "missing": missing, "not_live": not_live, "wrong_source": wrong_source, "conflicts": conflicts}
                report["groups"].append(entry)
                if apply and status == "ready":
                    group_id = str(uuid.uuid5(NAMESPACE, slug))
                    for position, question_id in enumerate(question_ids, 1):
                        if question_id in STEM_OVERRIDES:
                            cur.execute(
                                """UPDATE questions SET context_group_id=%s,shared_context=%s,
                                   context_position=%s,stem=%s,updated_at=now() WHERE id=%s""",
                                (group_id, scenario, position, STEM_OVERRIDES[question_id], question_id),
                            )
                        else:
                            cur.execute(
                                """UPDATE questions SET context_group_id=%s,shared_context=%s,
                                   context_position=%s,updated_at=now() WHERE id=%s""",
                                (group_id, scenario, position, question_id),
                            )
            if not apply:
                conn.rollback()
    report["ready_groups"] = sum(item["status"] == "ready" for item in report["groups"])
    report["ready_questions"] = sum(len(item["question_ids"]) for item in report["groups"] if item["status"] == "ready")
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Write verified groups to Neon")
    args = parser.parse_args()
    print(json.dumps(run(args.apply), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
